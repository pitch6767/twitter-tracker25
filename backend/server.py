from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone
import asyncio
import aiohttp
import json
import re
import base58
from io import StringIO
from bson import ObjectId

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI(title="Twitter/X Meme Token Tracker")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Twitter API Configuration (using Apify)
TWITTER_API_KEY = os.environ.get('TWITTER_API_KEY', '')
APIFY_API_BASE = "https://api.apify.com/v2"
TWITTER_SCRAPER_ACTOR_ID = "61RPP7dywgiy0JPD0"  # apidojo/tweet-scraper

# Global state for monitoring
monitoring_active = False
tracked_accounts = set()
websocket_connections = []

# Models
class TwitterAccount(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    username: str
    display_name: Optional[str] = None
    is_active: bool = True
    added_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    performance: Dict[str, Any] = Field(default_factory=dict)

class NameAlert(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    token_name: str
    first_seen: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    quorum_count: int = 1
    accounts: List[Dict[str, str]] = Field(default_factory=list)  # [{"username": "user1", "tweet_id": "123", "tweet_url": "..."}]
    is_active: bool = True

class CAAlert(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    contract_address: str
    token_name: str
    chain: str = "Solana"
    first_seen: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    first_market_cap: Optional[float] = None
    pump_fun_url: str
    solscan_url: str
    account_username: str
    tweet_id: str
    tweet_url: str
    max_gain_24h: Optional[float] = None
    ath_24h: Optional[float] = None

class AppVersion(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    version_number: int
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    tag: Optional[str] = None
    snapshot_data: Dict[str, Any]  # Complete app state
    is_current: bool = False

class BlacklistItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: str  # "account", "word", "domain"
    value: str
    added_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class AppSettings(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    dark_mode: bool = True
    sound_alerts: bool = True
    desktop_notifications: bool = True
    max_versions: int = 20
    monitoring_enabled: bool = False
    min_quorum_threshold: int = 3  # Minimum accounts needed to trigger name alert
    max_token_age_minutes: int = 10  # Maximum age for new token alerts (default 10 minutes)

# WebSocket Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections[:]:  # Copy list to avoid modification during iteration
            try:
                await connection.send_json(message)
            except:
                self.active_connections.remove(connection)

manager = ConnectionManager()

# Utility Functions
def validate_solana_contract(address: str) -> bool:
    """Validate Solana contract address format"""
    try:
        # Check Base58 format and length
        decoded = base58.b58decode(address)
        return len(decoded) == 32  # Solana addresses are 32 bytes
    except:
        return False

def is_pump_fun_contract(tweet_text: str) -> Optional[str]:
    """Extract and validate pump.fun contract address from tweet"""
    # Look for Solana addresses in tweet (Base58, 32-44 characters)
    address_pattern = r'\b[1-9A-HJ-NP-Za-km-z]{32,44}\b'
    addresses = re.findall(address_pattern, tweet_text)
    
    for addr in addresses:
        if validate_solana_contract(addr):
            return addr
    return None

async def get_twitter_user_tweets(username: str) -> List[Dict]:
    """Fetch recent tweets from a Twitter user using Apify"""
    if not TWITTER_API_KEY:
        return []
    
    headers = {
        'Content-Type': 'application/json'
    }
    
    # Use Apify Twitter scraper with token authentication
    search_url = f"{APIFY_API_BASE}/acts/{TWITTER_SCRAPER_ACTOR_ID}/runs?token={TWITTER_API_KEY}"
    
    try:
        # Apify API payload for Twitter scraper
        payload = {
            "searchTerms": [f"from:{username}"],
            "maxTweets": 10,
            "sort": "Latest"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(search_url, headers=headers, json=payload) as response:
                if response.status == 201:
                    run_data = await response.json()
                    run_id = run_data.get('data', {}).get('id')
                    
                    if run_id:
                        # Wait for the run to complete and get results
                        results_url = f"{APIFY_API_BASE}/actor-runs/{run_id}/dataset/items?token={TWITTER_API_KEY}"
                        
                        # Poll for results with longer wait time
                        await asyncio.sleep(10)  # Wait longer for scraper to complete
                        
                        async with session.get(results_url) as results_response:
                            if results_response.status == 200:
                                tweets = await results_response.json()
                                
                                # Filter out demo results
                                real_tweets = [tweet for tweet in tweets if not tweet.get('demo')]
                                
                                if real_tweets:
                                    logger.info(f"Successfully fetched {len(real_tweets)} real tweets for {username}")
                                    return real_tweets
                                else:
                                    logger.warning(f"Only demo results returned for {username} - may need account upgrade")
                                    return []
                            else:
                                logger.error(f"Failed to get results for {username}: {results_response.status}")
                                return []
                    else:
                        logger.error(f"No run ID returned for {username}")
                        return []
                else:
                    response_text = await response.text()
                    logger.error(f"Apify API error {response.status} for {username}: {response_text}")
                    return []
    except Exception as e:
        logger.error(f"Error fetching tweets for {username}: {e}")
    return []

async def extract_token_names(tweet_text: str) -> List[str]:
    """Extract potential meme token names from tweet text"""
    # Look for $TOKEN patterns and #hashtags
    token_pattern = r'\$([A-Z]{2,10})\b'
    hashtag_pattern = r'#([A-Za-z]{2,20})\b'
    
    tokens = re.findall(token_pattern, tweet_text.upper())
    hashtags = re.findall(hashtag_pattern, tweet_text)
    
    # Combine and filter
    all_tokens = tokens + [tag.upper() for tag in hashtags]
    return list(set(all_tokens))  # Remove duplicates

async def create_version_snapshot() -> Dict[str, Any]:
    """Create a complete snapshot of current app state"""
    def convert_objectid(obj):
        """Convert MongoDB ObjectId to string recursively"""
        if isinstance(obj, ObjectId):
            return str(obj)
        elif isinstance(obj, dict):
            return {k: convert_objectid(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [convert_objectid(v) for v in obj]
        else:
            return obj
    
    accounts = await db.twitter_accounts.find().to_list(None)
    name_alerts = await db.name_alerts.find().to_list(None)
    ca_alerts = await db.ca_alerts.find().to_list(None)
    blacklist = await db.blacklist.find().to_list(None)
    settings = await db.app_settings.find_one() or {}
    
    # Convert ObjectIds to strings
    snapshot = {
        "accounts": convert_objectid(accounts),
        "name_alerts": convert_objectid(name_alerts), 
        "ca_alerts": convert_objectid(ca_alerts),
        "blacklist": convert_objectid(blacklist),
        "settings": convert_objectid(settings),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    
    return snapshot

# Background monitoring task
async def monitor_accounts():
    """Background task to monitor tracked accounts"""
    global monitoring_active
    
    while monitoring_active:
        try:
            accounts = await db.twitter_accounts.find({"is_active": True}).to_list(None)
            
            for account in accounts:
                username = account['username']
                tweets = await get_twitter_user_tweets(username)
                
                for tweet in tweets:
                    tweet_text = tweet.get('text', '')
                    tweet_id = tweet.get('id_str', '')
                    tweet_url = f"https://twitter.com/{username}/status/{tweet_id}"
                    
                    # Check for token names (Name Alerts)
                    token_names = await extract_token_names(tweet_text)
                    for token_name in token_names:
                        await process_name_alert(token_name, username, tweet_id, tweet_url)
                    
                    # Check for contract addresses (CA Alerts)
                    contract_address = is_pump_fun_contract(tweet_text)
                    if contract_address:
                        await process_ca_alert(contract_address, username, tweet_id, tweet_url, tweet_text)
            
            await asyncio.sleep(5)  # Check every 5 seconds for real-time monitoring
            
        except Exception as e:
            logging.error(f"Monitoring error: {e}")
            await asyncio.sleep(10)

async def process_name_alert(token_name: str, username: str, tweet_id: str, tweet_url: str):
    """Process and create/update name alerts with quorum threshold"""
    # Get current settings for quorum threshold
    settings = await db.app_settings.find_one() or {}
    min_threshold = settings.get('min_quorum_threshold', 3)  # Default to 3 if not set
    
    # Check if alert already exists for this token
    existing_alert = await db.name_alerts.find_one({"token_name": token_name, "is_active": True})
    
    if existing_alert:
        # Check if this username already contributed to this alert
        existing_usernames = [acc.get('username') for acc in existing_alert.get('accounts', [])]
        
        if username not in existing_usernames:
            # Update existing alert with new account
            new_quorum_count = existing_alert.get('quorum_count', 0) + 1
            
            await db.name_alerts.update_one(
                {"_id": existing_alert["_id"]},
                {
                    "$set": {"quorum_count": new_quorum_count},
                    "$push": {"accounts": {"username": username, "tweet_id": tweet_id, "tweet_url": tweet_url}}
                }
            )
            
            # Only broadcast if we've reached the minimum threshold
            if new_quorum_count >= min_threshold:
                # Broadcast update
                await manager.broadcast({
                    "type": "name_alert_update",
                    "data": {
                        "token_name": token_name,
                        "quorum_count": new_quorum_count,
                        "new_account": username,
                        "threshold_met": True
                    }
                })
                logger.info(f"Name alert threshold reached for {token_name}: {new_quorum_count}/{min_threshold}")
        else:
            logger.info(f"Account {username} already contributed to {token_name} alert")
    else:
        # Create new alert (but don't broadcast until threshold is met)
        alert = NameAlert(
            token_name=token_name,
            quorum_count=1,
            accounts=[{"username": username, "tweet_id": tweet_id, "tweet_url": tweet_url}]
        )
        await db.name_alerts.insert_one(alert.dict())
        
        # Only broadcast if threshold is 1 or less (immediate alert)
        if min_threshold <= 1:
            await manager.broadcast({
                "type": "name_alert",
                "data": alert.dict()
            })
            logger.info(f"Immediate name alert for {token_name} (threshold: {min_threshold})")
        else:
            logger.info(f"New token {token_name} detected (1/{min_threshold} accounts needed)")

async def is_new_token(contract_address: str) -> bool:
    """Check if this contract is within the configured age limit - catch ultra-fresh launches"""
    try:
        # Get user's preferred max age setting
        settings = await db.app_settings.find_one() or {}
        max_age_minutes = settings.get('max_token_age_minutes', 10)  # Default 10 minutes
        
        async with aiohttp.ClientSession() as session:
            # Check Solscan API for token creation time
            solscan_url = f"https://public-api.solscan.io/account/{contract_address}"
            
            async with session.get(solscan_url, timeout=5) as response:
                if response.status == 200:
                    data = await response.json()
                    
                    # Get token creation timestamp
                    created_time = data.get('createdTime')
                    if created_time:
                        import time
                        current_time = time.time()
                        token_age_minutes = (current_time - created_time) / 60
                        
                        # Only alert if token is within user's age limit
                        if token_age_minutes <= max_age_minutes:
                            logger.info(f"🚨 ULTRA FRESH: {contract_address} - {token_age_minutes:.1f} min old (limit: {max_age_minutes} min)")
                            return True
                        else:
                            logger.info(f"❌ TOO OLD: {contract_address} - {token_age_minutes:.1f} min old (limit: {max_age_minutes} min)")
                            return False
                    else:
                        # If no creation time, assume it's new
                        logger.info(f"✅ FRESH: {contract_address} - No creation time (very new)")
                        return True
                else:
                    # If not found in Solscan, it's extremely new
                    logger.info(f"🔥 ULTRA FRESH: {contract_address} - Not indexed yet!")
                    return True
                    
    except Exception as e:
        logger.warning(f"Token age check failed for {contract_address}: {e}")
        # If check fails, assume it's new to avoid missing opportunities
        return True
    
    return True

async def process_ca_alert(contract_address: str, username: str, tweet_id: str, tweet_url: str, tweet_text: str):
    """Process and create INSTANT CA alerts for NEW TOKENS ONLY"""
    
    # Check if CA alert already exists
    existing_ca = await db.ca_alerts.find_one({"contract_address": contract_address})
    if existing_ca:
        logger.info(f"CA alert already exists for {contract_address}")
        return  # Only one alert per CA
    
    # 🚀 NEW TOKEN FILTER - Only alert on genuinely new meme coins
    if not await is_new_token(contract_address):
        logger.info(f"🛑 FILTERING OUT established token: {contract_address}")
        return  # Skip established tokens
    
    # Extract potential token name from the tweet (fallback if no clear token name)
    token_names = await extract_token_names(tweet_text)
    token_name = token_names[0] if token_names else "NEW"
    
    # CREATE CA ALERT IMMEDIATELY - ONLY FOR NEW TOKENS
    alert = CAAlert(
        contract_address=contract_address,
        token_name=token_name,
        pump_fun_url=f"https://pump.fun/{contract_address}",
        solscan_url=f"https://solscan.io/account/{contract_address}",
        account_username=username,
        tweet_id=tweet_id,
        tweet_url=tweet_url
    )
    
    await db.ca_alerts.insert_one(alert.dict())
    
    logger.info(f"🚨 NEW MEME COIN ALERT: {token_name} - {contract_address} by @{username}")
    logger.info(f"⚡ Fresh launch detected - Perfect for early trading!")
    
    # Broadcast CA alert IMMEDIATELY
    await manager.broadcast({
        "type": "ca_alert",
        "data": alert.dict()
    })

# WebSocket route (add to main app, not router)
@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket):
    try:
        await manager.connect(websocket)
        logging.info(f"WebSocket connected: {websocket.client}")
        
        # Send initial connection confirmation
        await websocket.send_json({"type": "connection", "status": "connected"})
        
        while True:
            # Keep connection alive and listen for messages
            data = await websocket.receive_text()
            logging.info(f"Received WebSocket message: {data}")
            
            # Echo back to confirm connection
            await websocket.send_json({"type": "echo", "message": data})
            
    except WebSocketDisconnect:
        logging.info(f"WebSocket disconnected: {websocket.client}")
        manager.disconnect(websocket)
    except Exception as e:
        logging.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)

# API Routes

@api_router.post("/accounts/bulk-import")
async def bulk_import_accounts(data: dict):
    """Bulk import Twitter accounts from pasted text"""
    accounts_text = data.get('accounts_text', '')
    
    if not accounts_text.strip():
        raise HTTPException(status_code=400, detail="No account data provided")
    
    # Split by lines and clean up
    lines = accounts_text.strip().split('\n')
    
    # Clean and validate usernames
    clean_usernames = []
    for line in lines:
        # Handle Excel copy-paste which might have tabs, commas, or spaces
        usernames_in_line = line.replace('\t', ' ').replace(',', ' ').split()
        
        for username in usernames_in_line:
            username = username.strip().replace('@', '')
            if username and len(clean_usernames) < 200:  # Limit to 200 accounts
                clean_usernames.append(username)
    
    # Remove duplicates from input
    clean_usernames = list(set(clean_usernames))
    
    if not clean_usernames:
        raise HTTPException(status_code=400, detail="No valid usernames found in the provided text")
    
    # Save to database
    accounts_added = 0
    existing_accounts = []
    
    for username in clean_usernames:
        existing = await db.twitter_accounts.find_one({"username": username})
        if not existing:
            account = TwitterAccount(username=username)
            await db.twitter_accounts.insert_one(account.dict())
            accounts_added += 1
        else:
            existing_accounts.append(username)
    
    # Create version snapshot after import
    if accounts_added > 0:
        snapshot = await create_version_snapshot()
        version_count = await db.app_versions.count_documents({})
        version = AppVersion(
            version_number=version_count + 1,
            snapshot_data=snapshot,
            tag=f"Bulk imported {accounts_added} accounts"
        )
        await db.app_versions.insert_one(version.dict())
    
    return {
        "accounts_imported": accounts_added, 
        "total_provided": len(clean_usernames),
        "duplicates_skipped": len(existing_accounts),
        "existing_accounts": existing_accounts[:10]  # Show first 10 duplicates
    }

@api_router.post("/accounts/add")
async def add_single_account(username: str):
    """Add a single Twitter account"""
    # Clean username
    username = username.strip().replace('@', '')
    
    if not username:
        raise HTTPException(status_code=400, detail="Username cannot be empty")
    
    # Check if account already exists
    existing = await db.twitter_accounts.find_one({"username": username})
    if existing:
        raise HTTPException(status_code=400, detail="Account already exists")
    
    # Add account
    account = TwitterAccount(username=username)
    await db.twitter_accounts.insert_one(account.dict())
    
    return {"message": "Account added successfully", "username": username}

@api_router.delete("/accounts/{account_id}")
async def remove_account(account_id: str):
    """Remove a Twitter account"""
    result = await db.twitter_accounts.delete_one({"id": account_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Account not found")
    
    return {"message": "Account removed successfully"}

@api_router.get("/accounts")
async def get_accounts():
    """Get all tracked accounts"""
    accounts = await db.twitter_accounts.find().to_list(None)
    # Convert ObjectIds to strings
    def convert_objectid(obj):
        if isinstance(obj, ObjectId):
            return str(obj)
        elif isinstance(obj, dict):
            return {k: convert_objectid(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [convert_objectid(v) for v in obj]
        else:
            return obj
    return convert_objectid(accounts)

@api_router.post("/monitoring/start")
async def start_monitoring(background_tasks: BackgroundTasks):
    """Start monitoring tracked accounts"""
    global monitoring_active
    
    if not TWITTER_API_KEY:
        raise HTTPException(status_code=400, detail="Twitter API key not configured")
    
    monitoring_active = True
    background_tasks.add_task(monitor_accounts)
    
    await db.app_settings.update_one(
        {},
        {"$set": {"monitoring_enabled": True}},
        upsert=True
    )
    
    return {"status": "Monitoring started"}

@api_router.post("/monitoring/stop")
async def stop_monitoring():
    """Stop monitoring"""
    global monitoring_active
    monitoring_active = False
    
    await db.app_settings.update_one(
        {},
        {"$set": {"monitoring_enabled": False}},
        upsert=True
    )
    
    return {"status": "Monitoring stopped"}

@api_router.get("/alerts/name")
async def get_name_alerts():
    """Get all name alerts that meet the quorum threshold"""
    settings = await db.app_settings.find_one() or {}
    min_threshold = settings.get('min_quorum_threshold', 3)
    
    # Only return alerts that meet the minimum threshold
    alerts = await db.name_alerts.find({
        "is_active": True,
        "quorum_count": {"$gte": min_threshold}
    }).sort("first_seen", -1).to_list(None)
    
    # Convert ObjectIds to strings
    for alert in alerts:
        if '_id' in alert:
            alert['_id'] = str(alert['_id'])
        # Convert any datetime objects to ISO strings
        if isinstance(alert.get('first_seen'), datetime):
            alert['first_seen'] = alert['first_seen'].isoformat()
    
    return alerts

@api_router.get("/alerts/ca")
async def get_ca_alerts():
    """Get all CA alerts"""
    alerts = await db.ca_alerts.find().sort("first_seen", -1).to_list(None)
    
    # Convert ObjectIds to strings
    for alert in alerts:
        if '_id' in alert:
            alert['_id'] = str(alert['_id'])
        # Convert any datetime objects to ISO strings
        if isinstance(alert.get('first_seen'), datetime):
            alert['first_seen'] = alert['first_seen'].isoformat()
    
    return alerts

@api_router.get("/dashboard/stats")
async def get_dashboard_stats():
    """Get dashboard statistics"""
    settings = await db.app_settings.find_one() or {}
    min_threshold = settings.get('min_quorum_threshold', 3)
    
    total_accounts = await db.twitter_accounts.count_documents({"is_active": True})
    # Only count name alerts that meet the threshold
    total_name_alerts = await db.name_alerts.count_documents({
        "is_active": True,
        "quorum_count": {"$gte": min_threshold}
    })
    total_ca_alerts = await db.ca_alerts.count_documents({})
    
    return {
        "total_accounts": total_accounts,
        "total_name_alerts": total_name_alerts,
        "total_ca_alerts": total_ca_alerts,
        "monitoring_active": settings.get("monitoring_enabled", False),
        "min_quorum_threshold": min_threshold
    }

@api_router.get("/versions")
async def get_versions():
    """Get all app versions"""
    versions = await db.app_versions.find().sort("version_number", -1).to_list(None)
    # Convert ObjectIds to strings
    def convert_objectid(obj):
        if isinstance(obj, ObjectId):
            return str(obj)
        elif isinstance(obj, dict):
            return {k: convert_objectid(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [convert_objectid(v) for v in obj]
        else:
            return obj
    return convert_objectid(versions)

@api_router.post("/versions/create")
async def create_version(tag: Optional[str] = None):
    """Create a new version snapshot"""
    snapshot = await create_version_snapshot()
    version_count = await db.app_versions.count_documents({})
    
    version = AppVersion(
        version_number=version_count + 1,
        snapshot_data=snapshot,
        tag=tag or f"Manual snapshot #{version_count + 1}"
    )
    await db.app_versions.insert_one(version.dict())
    
    # Clean old versions (keep last 20)
    all_versions = await db.app_versions.find().sort("version_number", -1).to_list(None)
    if len(all_versions) > 20:
        versions_to_delete = all_versions[20:]
        for old_version in versions_to_delete:
            await db.app_versions.delete_one({"_id": old_version["_id"]})
    
    return version.dict()

@api_router.post("/versions/{version_id}/restore")
async def restore_version(version_id: str):
    """Restore app to a specific version"""
    version = await db.app_versions.find_one({"id": version_id})
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    
    snapshot = version["snapshot_data"]
    
    # Clear current data
    await db.twitter_accounts.delete_many({})
    await db.name_alerts.delete_many({})
    await db.ca_alerts.delete_many({})
    await db.blacklist.delete_many({})
    
    # Restore snapshot data
    if snapshot.get("accounts"):
        await db.twitter_accounts.insert_many(snapshot["accounts"])
    if snapshot.get("name_alerts"):
        await db.name_alerts.insert_many(snapshot["name_alerts"])
    if snapshot.get("ca_alerts"):
        await db.ca_alerts.insert_many(snapshot["ca_alerts"])
    if snapshot.get("blacklist"):
        await db.blacklist.insert_many(snapshot["blacklist"])
    if snapshot.get("settings"):
        await db.app_settings.replace_one({}, snapshot["settings"], upsert=True)
    
    return {"status": "Version restored successfully"}

@api_router.get("/export")
async def export_data():
    """Export all alerts and performance data"""
    name_alerts = await db.name_alerts.find().to_list(None)
    ca_alerts = await db.ca_alerts.find().to_list(None)
    accounts = await db.twitter_accounts.find().to_list(None)
    
    # Convert ObjectIds to strings
    def convert_objectid(obj):
        if isinstance(obj, ObjectId):
            return str(obj)
        elif isinstance(obj, dict):
            return {k: convert_objectid(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [convert_objectid(v) for v in obj]
        else:
            return obj
    
    export_data = {
        "export_timestamp": datetime.now(timezone.utc).isoformat(),
        "name_alerts": convert_objectid(name_alerts),
        "ca_alerts": convert_objectid(ca_alerts),
        "accounts": convert_objectid(accounts)
    }
    
    return export_data

@api_router.get("/settings")
async def get_settings():
    """Get app settings"""
    settings = await db.app_settings.find_one() or {}
    # Convert ObjectIds to strings
    def convert_objectid(obj):
        if isinstance(obj, ObjectId):
            return str(obj)
        elif isinstance(obj, dict):
            return {k: convert_objectid(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [convert_objectid(v) for v in obj]
        else:
            return obj
    return convert_objectid(settings)

@api_router.post("/settings")
async def update_settings(settings: AppSettings):
    """Update app settings"""
    await db.app_settings.replace_one({}, settings.dict(), upsert=True)
    return settings.dict()

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    global monitoring_active
    monitoring_active = False
    client.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)