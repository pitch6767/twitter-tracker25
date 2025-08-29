import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Badge } from './components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Alert, AlertDescription } from './components/ui/alert';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Switch } from './components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './components/ui/dialog';
import { Textarea } from './components/ui/textarea';
import { AlertTriangle, Upload, Play, Square, Download, Settings, Clock, TrendingUp, Users, Target, RotateCcw, Volume2, VolumeX, Moon, Sun, Wifi, WifiOff, ExternalLink, Copy, CheckCircle, AlertCircle } from 'lucide-react';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function App() {
  const [accounts, setAccounts] = useState([]);
  const [nameAlerts, setNameAlerts] = useState([]);
  const [caAlerts, setCaAlerts] = useState([]);
  const [versions, setVersions] = useState([]);
  const [stats, setStats] = useState({
    total_accounts: 0,
    total_name_alerts: 0,
    total_ca_alerts: 0,
    monitoring_active: false
  });
  const [settings, setSettings] = useState({
    dark_mode: true,
    sound_alerts: true,
    desktop_notifications: true,
    monitoring_enabled: false,
    min_quorum_threshold: 3
  });
  const [uploadStatus, setUploadStatus] = useState('');
  const [bulkAccountsText, setBulkAccountsText] = useState('');
  const [websocket, setWebsocket] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [newVersionTag, setNewVersionTag] = useState('');
  const [showAccountsModal, setShowAccountsModal] = useState(false);
  const [newAccountInput, setNewAccountInput] = useState('');
  const [addAccountStatus, setAddAccountStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  // WebSocket connection
  const connectWebSocket = useCallback(() => {
    // Try WebSocket connection first
    const wsUrl = `${BACKEND_URL.replace('https', 'wss').replace('http', 'ws')}/api/ws`;
    console.log('Attempting WebSocket connection to:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('WebSocket connected successfully');
      setConnectionStatus('connected');
      setWebsocket(ws);
      
      // Send a ping to test connection
      ws.send(JSON.stringify({type: 'ping', timestamp: Date.now()}));
    };
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('WebSocket message received:', message);
        
        if (message.type === 'connection' && message.status === 'connected') {
          console.log('WebSocket connection confirmed by server');
          return;
        }
        
        if (message.type === 'echo') {
          console.log('WebSocket echo received:', message.message);
          return;
        }
        
        // Handle alert messages
        if (message.type === 'name_alert') {
          setNameAlerts(prev => [message.data, ...prev]);
          if (settings.desktop_notifications) {
            new Notification('New Meme Token Alert!', {
              body: `${message.data.token_name} mentioned by ${message.data.accounts[0]?.username}`,
              icon: '/favicon.ico'
            });
          }
          if (settings.sound_alerts) {
            // Play sound for name alert
            const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwgAwaAye3ahjEKHm+57+CVQQUMZL3q2ZdODw==');
            audio.play().catch(e => console.log('Could not play sound:', e));
          }
        } else if (message.type === 'ca_alert') {
          setCaAlerts(prev => [message.data, ...prev]);
          if (settings.desktop_notifications) {
            new Notification('🚨 CONTRACT ADDRESS ALERT!', {
              body: `${message.data.token_name} - ${message.data.contract_address}`,
              icon: '/favicon.ico'
            });
          }
          if (settings.sound_alerts) {
            // Play different sound for CA alert (more urgent)
            const audio = new Audio('data:audio/wav;base64,UklGRvIGAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YU4GAABBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwgAwaAye3ahjEKHm+57+CVQQUMZL3q2ZdODw==');
            audio.play().catch(e => console.log('Could not play sound:', e));
          }
        } else if (message.type === 'name_alert_update') {
          setNameAlerts(prev => prev.map(alert => 
            alert.token_name === message.data.token_name 
              ? { ...alert, quorum_count: message.data.quorum_count }
              : alert
          ));
        }
        
        // Refresh stats after any alert
        fetchStats();
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setConnectionStatus('disconnected');
      setWebsocket(null);
      // Retry connection after 5 seconds
      setTimeout(connectWebSocket, 5000);
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnectionStatus('error');
      setWebsocket(null);
      // Fallback to polling if WebSocket fails
      setTimeout(startPollingFallback, 1000);
    };
  }, [settings.desktop_notifications, settings.sound_alerts]);
  
  // Fallback polling mechanism if WebSocket fails
  const startPollingFallback = useCallback(() => {
    console.log('Starting polling fallback for real-time updates');
    setConnectionStatus('polling');
    
    const pollInterval = setInterval(async () => {
      try {
        // Poll for updates every 10 seconds
        await fetchStats();
        await fetchNameAlerts();
        await fetchCaAlerts();
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 10000);
    
    // Store interval ID for cleanup
    window.pollingInterval = pollInterval;
  }, []);

  // Fetch data functions
  const fetchAccounts = async () => {
    try {
      const response = await axios.get(`${API}/accounts`);
      setAccounts(response.data);
    } catch (error) {
      console.error('Error fetching accounts:', error);
    }
  };

  const fetchNameAlerts = async () => {
    try {
      const response = await axios.get(`${API}/alerts/name`);
      setNameAlerts(response.data);
    } catch (error) {
      console.error('Error fetching name alerts:', error);
    }
  };

  const fetchCaAlerts = async () => {
    try {
      const response = await axios.get(`${API}/alerts/ca`);
      setCaAlerts(response.data);
    } catch (error) {
      console.error('Error fetching CA alerts:', error);
    }
  };

  const fetchVersions = async () => {
    try {
      const response = await axios.get(`${API}/versions`);
      setVersions(response.data);
    } catch (error) {
      console.error('Error fetching versions:', error);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await axios.get(`${API}/dashboard/stats`);
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchSettings = async () => {
    try {
      const response = await axios.get(`${API}/settings`);
      setSettings({ ...settings, ...response.data });
    } catch (error) {
      console.error('Error fetching settings:', error);
    }
  };

  // Actions
  const handleBulkImport = async () => {
    if (!bulkAccountsText.trim()) return;

    try {
      setUploadStatus('Processing...');
      const response = await axios.post(`${API}/accounts/bulk-import`, {
        accounts_text: bulkAccountsText
      });
      
      const { accounts_imported, total_provided, duplicates_skipped, existing_accounts } = response.data;
      
      let statusMessage = `✅ Imported ${accounts_imported} accounts`;
      if (duplicates_skipped > 0) {
        statusMessage += ` (${duplicates_skipped} duplicates skipped)`;
      }
      
      if (existing_accounts && existing_accounts.length > 0) {
        statusMessage += `\n📋 Skipped: ${existing_accounts.join(', ')}${existing_accounts.length > 10 ? '...' : ''}`;
      }
      
      setUploadStatus(statusMessage);
      setBulkAccountsText(''); // Clear the textarea
      setTimeout(() => setUploadStatus(''), 7000);
      
      fetchAccounts();
      fetchStats();
    } catch (error) {
      setUploadStatus(`❌ ${error.response?.data?.detail || 'Import failed'}`);
      setTimeout(() => setUploadStatus(''), 4000);
      console.error('Bulk import error:', error);
    }
  };

  const toggleMonitoring = async () => {
    try {
      if (stats.monitoring_active) {
        await axios.post(`${API}/monitoring/stop`);
      } else {
        await axios.post(`${API}/monitoring/start`);
      }
      fetchStats();
    } catch (error) {
      console.error('Error toggling monitoring:', error);
    }
  };

  const exportData = async () => {
    try {
      const response = await axios.get(`${API}/export`);
      const dataStr = JSON.stringify(response.data, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
      
      const exportFileDefaultName = `meme_tracker_export_${new Date().toISOString().split('T')[0]}.json`;
      
      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', dataUri);
      linkElement.setAttribute('download', exportFileDefaultName);
      linkElement.click();
    } catch (error) {
      console.error('Error exporting data:', error);
    }
  };

  const createVersion = async () => {
    try {
      await axios.post(`${API}/versions/create`, null, {
        params: { tag: newVersionTag || undefined }
      });
      setNewVersionTag('');
      fetchVersions();
    } catch (error) {
      console.error('Error creating version:', error);
    }
  };

  const restoreVersion = async (versionId) => {
    if (!window.confirm('Are you sure you want to restore this version? This will overwrite all current data.')) {
      return;
    }
    
    try {
      await axios.post(`${API}/versions/${versionId}/restore`);
      // Refresh all data
      fetchAccounts();
      fetchNameAlerts();
      fetchCaAlerts();
      fetchStats();
      fetchSettings();
    } catch (error) {
      console.error('Error restoring version:', error);
    }
  };

  const updateSettings = async (newSettings) => {
    try {
      await axios.post(`${API}/settings`, newSettings);
      setSettings(newSettings);
    } catch (error) {
      console.error('Error updating settings:', error);
    }
  };

  const addSingleAccount = async () => {
    if (!newAccountInput.trim()) return;
    
    try {
      const username = newAccountInput.trim().replace('@', '');
      setAddAccountStatus('Adding...');
      
      await axios.post(`${API}/accounts/add?username=${encodeURIComponent(username)}`);
      
      setNewAccountInput('');
      setAddAccountStatus(`✅ @${username} added successfully`);
      setTimeout(() => setAddAccountStatus(''), 3000);
      
      fetchAccounts();
      fetchStats();
    } catch (error) {
      console.error('Error adding account:', error);
      
      if (error.response?.status === 400 && error.response.data?.detail === 'Account already exists') {
        setAddAccountStatus(`⚠️ @${newAccountInput.trim().replace('@', '')} already exists`);
      } else {
        setAddAccountStatus(`❌ ${error.response?.data?.detail || 'Error adding account'}`);
      }
      
      setTimeout(() => setAddAccountStatus(''), 4000);
    }
  };

  const removeAccount = async (accountId, username) => {
    try {
      console.log('Removing account:', accountId, username); // Debug log
      await axios.delete(`${API}/accounts/${accountId}`);
      
      // Show success feedback
      alert(`✅ @${username} removed successfully`);
      
      fetchAccounts();
      fetchStats();
    } catch (error) {
      console.error('Error removing account:', error);
      console.error('Account ID:', accountId); // Debug log
      
      if (error.response?.status === 404) {
        alert('❌ Account not found. It may have already been removed.');
      } else {
        alert(`❌ Error removing account: ${error.response?.data?.detail || 'Unknown error'}`);
      }
    }
  };

  const openTwitterProfile = (username) => {
    window.open(`https://twitter.com/${username}`, '_blank');
  };

  const openTweet = (tweetUrl) => {
    window.open(tweetUrl, '_blank');
  };

  const openPhotonChart = (contractAddress) => {
    // Correct Photon URL format for direct token access
    const photonUrl = `https://photon-sol.tinyastro.io/en/lp/${contractAddress}?chainId=101`;
    
    console.log('🚀 PHOTON TRADING:', contractAddress);
    console.log('📊 Opening Photon 1s Chart:', photonUrl);
    
    // Force open in new tab - critical for meme coin trading speed
    const photonWindow = window.open(photonUrl, '_blank', 'noopener,noreferrer');
    
    if (!photonWindow) {
      console.error('❌ POPUP BLOCKED! Enable popups for instant Photon access');
      alert('⚠️ POPUP BLOCKED!\n\nFor 1-second meme coin trading, you MUST allow popups.\nCheck your browser popup settings.');
    } else {
      console.log('✅ Photon chart opened - Ready for 1s trading!');
    }
  };

  const checkIfAccountExists = (username) => {
    const cleanUsername = username.toLowerCase().replace('@', '');
    return accounts.some(account => account.username.toLowerCase() === cleanUsername);
  };

  const getDuplicateWarning = () => {
    if (!newAccountInput.trim()) return '';
    
    const cleanUsername = newAccountInput.trim().replace('@', '');
    if (checkIfAccountExists(cleanUsername)) {
      return `⚠️ @${cleanUsername} already tracked`;
    }
    return '';
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  // Filter accounts based on search query
  const filteredAccounts = accounts.filter(account => 
    account.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Clear search when modal closes
  const handleModalClose = (open) => {
    setShowAccountsModal(open);
    if (!open) {
      setSearchQuery('');
    }
  };

  const showAlertDetails = (alert) => {
    setSelectedAlert(alert);
    setShowAlertModal(true);
  };

  const requestNotificationPermission = async () => {
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  };

  // Initialize
  useEffect(() => {
    fetchAccounts();
    fetchNameAlerts();
    fetchCaAlerts();
    fetchVersions();
    fetchStats();
    fetchSettings();
    connectWebSocket();
    requestNotificationPermission();

    // Start real-time clock
    const clockInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    // Cleanup websocket and polling on unmount
    return () => {
      if (websocket) {
        websocket.close();
      }
      if (window.pollingInterval) {
        clearInterval(window.pollingInterval);
      }
      clearInterval(clockInterval);
    };
  }, [connectWebSocket]);

  // Apply dark mode
  useEffect(() => {
    document.body.className = settings.dark_mode ? 'dark' : '';
  }, [settings.dark_mode]);

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  const getTimeSince = (dateString) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    return `${Math.floor(diffInSeconds / 86400)}d ago`;
  };

  const formatUTCTime = (dateString) => {
    const date = new Date(dateString);
    return date.toUTCString().split(' ')[4]; // Gets HH:MM:SS from UTC string
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 ${settings.dark_mode ? 'dark bg-gray-900' : 'bg-gray-50'}`}>
      <div className="container mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className={`text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent`}>
              🚀 Meme Token Tracker
            </h1>
            <p className={`text-lg mt-2 ${settings.dark_mode ? 'text-gray-300' : 'text-gray-600'}`}>
              Real-time Twitter monitoring for meme tokens & contract alerts
            </p>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Connection Status */}
            <div className="flex items-center gap-2">
              {connectionStatus === 'connected' ? (
                <><Wifi className="w-5 h-5 text-green-500" /><span className="text-green-500">Live</span></>
              ) : connectionStatus === 'polling' ? (
                <><Wifi className="w-5 h-5 text-blue-500" /><span className="text-blue-500">Polling</span></>
              ) : connectionStatus === 'error' ? (
                <><WifiOff className="w-5 h-5 text-red-500" /><span className="text-red-500">Error</span></>
              ) : (
                <><WifiOff className="w-5 h-5 text-yellow-500" /><span className="text-yellow-500">Connecting...</span></>
              )}
            </div>
            
            {/* Settings */}
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>App Settings</DialogTitle>
                </DialogHeader>
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="dark-mode">Dark Mode</Label>
                    <Switch
                      id="dark-mode"
                      checked={settings.dark_mode}
                      onCheckedChange={(checked) => updateSettings({...settings, dark_mode: checked})}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="sound-alerts">Sound Alerts</Label>
                    <Switch
                      id="sound-alerts"
                      checked={settings.sound_alerts}
                      onCheckedChange={(checked) => updateSettings({...settings, sound_alerts: checked})}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="desktop-notifications">Desktop Notifications</Label>
                    <Switch
                      id="desktop-notifications"
                      checked={settings.desktop_notifications}
                      onCheckedChange={(checked) => updateSettings({...settings, desktop_notifications: checked})}
                    />
                  </div>
                  
                  <div className={`border-t pt-4 ${settings.dark_mode ? 'border-gray-600' : 'border-gray-200'}`}>
                    <h4 className={`text-sm font-semibold mb-3 ${settings.dark_mode ? 'text-white' : ''}`}>
                      🎯 Alert Filtering
                    </h4>
                    <div className="space-y-3">
                      <div>
                        <Label htmlFor="quorum-threshold" className="text-sm">
                          Minimum Accounts for Name Alert
                        </Label>
                        <div className="flex items-center gap-3 mt-2">
                          <Input
                            id="quorum-threshold"
                            type="number"
                            min="1"
                            max="10"
                            value={settings.min_quorum_threshold}
                            onChange={(e) => updateSettings({...settings, min_quorum_threshold: parseInt(e.target.value) || 3})}
                            className="w-20"
                          />
                          <span className={`text-sm ${settings.dark_mode ? 'text-gray-300' : 'text-gray-600'}`}>
                            accounts must mention same token
                          </span>
                        </div>
                        <p className={`text-xs mt-1 ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                          Only show alerts when {settings.min_quorum_threshold}+ different accounts mention the same meme token
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className={settings.dark_mode ? 'bg-gray-800 border-gray-700' : ''}>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <Users className="w-8 h-8 text-blue-500" />
                <div>
                  <p className={`text-2xl font-bold ${settings.dark_mode ? 'text-white' : 'text-gray-900'}`}>
                    {stats.total_accounts}
                  </p>
                  <p className={`text-sm ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Tracked Accounts
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={settings.dark_mode ? 'bg-gray-800 border-gray-700' : ''}>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <Target className="w-8 h-8 text-green-500" />
                <div>
                  <p className={`text-2xl font-bold ${settings.dark_mode ? 'text-white' : 'text-gray-900'}`}>
                    {stats.total_name_alerts}
                  </p>
                  <p className={`text-sm ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Name Alerts
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={settings.dark_mode ? 'bg-gray-800 border-gray-700' : ''}>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-8 h-8 text-purple-500" />
                <div>
                  <p className={`text-2xl font-bold ${settings.dark_mode ? 'text-white' : 'text-gray-900'}`}>
                    {stats.total_ca_alerts}
                  </p>
                  <p className={`text-sm ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                    CA Alerts
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={settings.dark_mode ? 'bg-gray-800 border-gray-700' : ''}>
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                🎯
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="1"
                      max="10"
                      value={settings.min_quorum_threshold}
                      onChange={(e) => updateSettings({...settings, min_quorum_threshold: parseInt(e.target.value) || 3})}
                      className={`w-16 h-8 text-lg font-bold text-center ${settings.dark_mode ? 'bg-gray-700 text-white' : 'bg-white'}`}
                    />
                  </div>
                  <p className={`text-sm mt-1 ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Min Accounts Alert
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Tabs defaultValue="dashboard" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="accounts">Accounts</TabsTrigger>
            <TabsTrigger value="alerts">Alerts</TabsTrigger>
            <TabsTrigger value="versions">Versions</TabsTrigger>
            <TabsTrigger value="export">Export</TabsTrigger>
          </TabsList>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-6">
            <div className="flex gap-4 mb-6">
              <Button
                onClick={toggleMonitoring}
                size="lg"
                className={stats.monitoring_active ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}
              >
                {stats.monitoring_active ? (
                  <><Square className="w-5 h-5 mr-2" />Stop Monitoring</>
                ) : (
                  <><Play className="w-5 h-5 mr-2" />Start Monitoring</>
                )}
              </Button>
            </div>

            {/* Recent Alerts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Name Alerts */}
              <Card className={settings.dark_mode ? 'bg-gray-800 border-gray-700' : ''}>
                <CardHeader>
                  <CardTitle className={`flex items-center gap-2 ${settings.dark_mode ? 'text-white' : ''}`}>
                    <Target className="w-5 h-5" />
                    Recent Name Alerts
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 max-h-96 overflow-y-auto">
                  {nameAlerts.slice(0, 5).map((alert) => (
                    <Alert key={alert.id} className={settings.dark_mode ? 'bg-gray-700 border-gray-600' : ''}>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        <div className="flex justify-between items-center">
                          <div>
                            <strong className="text-lg">${alert.token_name}</strong>
                            <div className="text-sm opacity-75">
                              Quorum: {alert.quorum_count} | {getTimeSince(alert.first_seen)}
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => showAlertDetails(alert)}
                            className="hover:bg-blue-50 transition-colors"
                            title={`View all ${alert.quorum_count} accounts that mentioned $${alert.token_name}`}
                          >
                            <Badge variant="secondary" className="text-lg px-3 py-1 cursor-pointer hover:bg-blue-100">
                              {alert.quorum_count}
                            </Badge>
                          </Button>
                        </div>
                      </AlertDescription>
                    </Alert>
                  ))}
                  {nameAlerts.length === 0 && (
                    <div className={`text-center py-8 ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                      No name alerts yet. Start monitoring to see alerts appear here.
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* CA Alerts */}
              <Card className={settings.dark_mode ? 'bg-gray-800 border-gray-700' : ''}>
                <CardHeader>
                  <CardTitle className={`flex items-center gap-2 ${settings.dark_mode ? 'text-white' : ''}`}>
                    <TrendingUp className="w-5 h-5" />
                    Recent CA Alerts
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 max-h-96 overflow-y-auto">
                  {caAlerts.slice(0, 5).map((alert) => (
                    <Alert key={alert.id} className={`${settings.dark_mode ? 'bg-gray-700 border-gray-600' : ''} border-orange-500`}>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        <div className="space-y-3">
                          <div className="flex justify-between items-start">
                            <div>
                              <strong className="text-xl">${alert.token_name}</strong>
                              <Badge className="ml-3 bg-orange-600">Solana</Badge>
                            </div>
                            <div className="text-right">
                              <div className={`text-lg font-mono font-bold ${settings.dark_mode ? 'text-green-400' : 'text-green-600'}`}>
                                🕐 {formatUTCTime(alert.first_seen)}
                              </div>
                              <div className={`text-xs ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                                UTC Alert Time
                              </div>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <div>
                              <strong className="text-sm">Contract Address:</strong>
                              <div className="flex items-center gap-2 mt-1">
                                <code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded break-all flex-1">
                                  {alert.contract_address}
                                </code>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyToClipboard(alert.contract_address);
                                  }}
                                  className="p-1 h-auto"
                                  title="Copy Address"
                                >
                                  <Copy className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                            
                            <div>
                              <strong className="text-sm">Posted by:</strong>
                              <div className="flex items-center justify-between p-2 mt-1 rounded bg-gray-100 dark:bg-gray-800">
                                <span>@{alert.account_username}</span>
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openTweet(alert.tweet_url);
                                    }}
                                    className="p-1 h-auto"
                                    title="View Tweet"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openTwitterProfile(alert.account_username);
                                    }}
                                    className="p-1 h-auto"
                                    title="View Profile"
                                  >
                                    👤
                                  </Button>
                                </div>
                              </div>
                            </div>
                            
                            <div className="flex justify-center mt-3">
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openPhotonChart(alert.contract_address);
                                }}
                                className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2"
                              >
                                📊 Photon Chart (1s)
                              </Button>
                            </div>
                            
                            <div className={`text-xs text-center ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                              First seen: {getTimeSince(alert.first_seen)}
                            </div>
                          </div>
                        </div>
                      </AlertDescription>
                    </Alert>
                  ))}
                  {caAlerts.length === 0 && (
                    <div className={`text-center py-8 ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                      No CA alerts yet. Start monitoring to see alerts appear here.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Accounts Tab */}
          <TabsContent value="accounts" className="space-y-6">
            <Card className={settings.dark_mode ? 'bg-gray-800 border-gray-700' : ''}>
              <CardHeader>
                <CardTitle className={settings.dark_mode ? 'text-white' : ''}>Import Twitter Accounts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Bulk Import */}
                <div>
                  <h3 className={`text-lg font-semibold mb-3 ${settings.dark_mode ? 'text-white' : ''}`}>
                    Bulk Import from Excel/Text
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className={`text-sm font-medium ${settings.dark_mode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Paste Twitter Usernames (from Excel, CSV, or any text)
                      </label>
                      <Textarea
                        placeholder={`Paste your accounts here, one per line or separated by commas/tabs:\n\nelonmusk\nbillgates\n@jeffbezos\nmarkzuckerberg\n\nOr from Excel: just copy and paste directly!`}
                        value={bulkAccountsText}
                        onChange={(e) => setBulkAccountsText(e.target.value)}
                        className="h-32 resize-none"
                        rows={6}
                      />
                    </div>
                    <div className="flex items-center gap-4">
                      <Button 
                        onClick={handleBulkImport} 
                        disabled={!bulkAccountsText.trim()}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        Import Accounts
                      </Button>
                      {bulkAccountsText.trim() && (
                        <span className={`text-sm ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                          {bulkAccountsText.split(/[,\n\t\s]+/).filter(s => s.trim()).length} accounts detected
                        </span>
                      )}
                    </div>
                    {uploadStatus && (
                      <div className={`text-sm whitespace-pre-line ${
                        uploadStatus.includes('✅') ? 'text-green-600' : 
                        uploadStatus.includes('❌') ? 'text-red-600' : 
                        settings.dark_mode ? 'text-gray-300' : 'text-gray-600'
                      }`}>
                        {uploadStatus}
                      </div>
                    )}
                  </div>
                  <div className={`mt-3 text-sm ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                    💡 <strong>Excel users:</strong> Select your username column, copy (Ctrl+C), and paste here!
                    <br />
                    Supports: usernames with/without @, comma-separated, tab-separated, or line-by-line (max 200 accounts)
                  </div>
                </div>

                {/* Individual Import */}
                <div>
                  <h3 className={`text-lg font-semibold mb-3 ${settings.dark_mode ? 'text-white' : ''}`}>
                    Add Individual Account
                  </h3>
                  <div className="flex gap-3">
                    <Input
                      placeholder="@username or username"
                      value={newAccountInput}
                      onChange={(e) => setNewAccountInput(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          addSingleAccount();
                        }
                      }}
                      className={`flex-1 ${getDuplicateWarning() ? 'border-orange-400' : ''}`}
                    />
                    <Button 
                      onClick={addSingleAccount} 
                      disabled={!newAccountInput.trim() || getDuplicateWarning()}
                    >
                      Add Account
                    </Button>
                  </div>
                  {(addAccountStatus || getDuplicateWarning()) && (
                    <div className={`mt-2 text-sm ${
                      addAccountStatus?.includes('✅') ? 'text-green-600' : 
                      addAccountStatus?.includes('⚠️') || getDuplicateWarning() ? 'text-orange-600' :
                      addAccountStatus?.includes('❌') ? 'text-red-600' : 
                      settings.dark_mode ? 'text-gray-300' : 'text-gray-600'
                    }`}>
                      {getDuplicateWarning() || addAccountStatus}
                    </div>
                  )}
                  <div className={`mt-2 text-sm ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Enter username with or without @ symbol
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={settings.dark_mode ? 'bg-gray-800 border-gray-700' : ''}>
              <CardHeader>
                <CardTitle className={`flex items-center justify-between ${settings.dark_mode ? 'text-white' : ''}`}>
                  <span>Tracked Accounts ({accounts.length})</span>
                  <Button onClick={() => setShowAccountsModal(true)} variant="outline">
                    View All Accounts
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-96 overflow-y-auto">
                  {accounts.slice(0, 6).map((account) => (
                    <Card key={account.id} className={`p-4 ${settings.dark_mode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50'} hover:bg-opacity-80 transition-colors`}>
                      <div className="flex items-center justify-between">
                        <div 
                          className="cursor-pointer flex-1"
                          onClick={() => openTwitterProfile(account.username)}
                          title="Click to visit Twitter profile"
                        >
                          <div className={`font-medium hover:text-blue-500 transition-colors ${settings.dark_mode ? 'text-white' : ''}`}>
                            @{account.username}
                          </div>
                          <div className={`text-sm ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                            Added {getTimeSince(account.added_at)} • Click to visit
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-3">
                          <Badge variant={account.is_active ? "success" : "secondary"}>
                            {account.is_active ? "Active" : "Inactive"}
                          </Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              openTwitterProfile(account.username);
                            }}
                            className="p-1 h-auto"
                            title="Visit X Profile"
                          >
                            🔗
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeAccount(account.id, account.username);
                            }}
                            className="p-1 h-auto text-red-600 hover:text-red-800 hover:bg-red-50"
                            title="Remove Account"
                          >
                            ❌
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
                {accounts.length > 6 && (
                  <div className={`text-center mt-4 ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                    And {accounts.length - 6} more accounts... <Button variant="link" onClick={() => setShowAccountsModal(true)}>View All</Button>
                  </div>
                )}
                {accounts.length === 0 && (
                  <div className={`text-center py-8 ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                    No accounts tracked yet. Import accounts to get started.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Alerts Tab */}
          <TabsContent value="alerts" className="space-y-6">
            <Tabs defaultValue="name-alerts">
              <TabsList>
                <TabsTrigger value="name-alerts">Name Alerts ({nameAlerts.length})</TabsTrigger>
                <TabsTrigger value="ca-alerts">CA Alerts ({caAlerts.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="name-alerts">
                <Card className={settings.dark_mode ? 'bg-gray-800 border-gray-700' : ''}>
                  <CardContent className="p-6">
                    <div className="space-y-4 max-h-[600px] overflow-y-auto">
                      {nameAlerts.map((alert) => (
                        <Alert key={alert.id} className={`${settings.dark_mode ? 'bg-gray-700 border-gray-600' : ''} cursor-pointer hover:bg-opacity-80 transition-colors`}>
                          <Target className="h-4 w-4" />
                          <AlertDescription>
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                  <strong className="text-xl">${alert.token_name}</strong>
                                  <Badge variant="secondary">Quorum: {alert.quorum_count}</Badge>
                                  <span className={`text-sm ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    {formatDate(alert.first_seen)}
                                  </span>
                                </div>
                                <div className="space-y-2">
                                  <strong className="text-sm">Mentioned by:</strong>
                                  <div className="grid grid-cols-1 gap-2">
                                    {alert.accounts.map((acc, idx) => (
                                      <div key={idx} className="flex items-center justify-between p-2 rounded bg-gray-100 dark:bg-gray-800">
                                        <div className="flex items-center gap-2">
                                          <span>@{acc.username}</span>
                                        </div>
                                        <div className="flex gap-1">
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              openTweet(acc.tweet_url);
                                            }}
                                            className="p-1 h-auto"
                                            title="View Tweet"
                                          >
                                            <ExternalLink className="w-3 h-3" />
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              openTwitterProfile(acc.username);
                                            }}
                                            className="p-1 h-auto"
                                            title="View Profile"
                                          >
                                            👤
                                          </Button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </AlertDescription>
                        </Alert>
                      ))}
                      {nameAlerts.length === 0 && (
                        <div className={`text-center py-8 ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                          No name alerts yet. Start monitoring to see alerts appear here.
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="ca-alerts">
                <Card className={settings.dark_mode ? 'bg-gray-800 border-gray-700' : ''}>
                  <CardContent className="p-6">
                    <div className="space-y-4 max-h-[600px] overflow-y-auto">
                      {caAlerts.map((alert) => (
                        <Alert key={alert.id} className={`${settings.dark_mode ? 'bg-gray-700 border-gray-600' : ''} border-orange-500 cursor-pointer hover:bg-opacity-80 transition-colors`}>
                          <TrendingUp className="h-4 w-4" />
                          <AlertDescription>
                            <div className="space-y-3">
                              <div className="flex justify-between items-start">
                                <div>
                                  <strong className="text-xl">${alert.token_name}</strong>
                                  <Badge className="ml-3 bg-orange-600">Solana</Badge>
                                </div>
                                <span className={`text-sm ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                                  {formatDate(alert.first_seen)}
                                </span>
                              </div>
                              
                              <div className="space-y-3">
                                <div>
                                  <strong className="text-sm">Contract Address:</strong>
                                  <div className="flex items-center gap-2 mt-1">
                                    <code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded break-all flex-1">
                                      {alert.contract_address}
                                    </code>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        copyToClipboard(alert.contract_address);
                                      }}
                                      className="p-1 h-auto"
                                      title="Copy Address"
                                    >
                                      <Copy className="w-3 h-3" />
                                    </Button>
                                  </div>
                                </div>
                                
                                <div>
                                  <strong className="text-sm">Posted by:</strong>
                                  <div className="flex items-center justify-between p-2 mt-1 rounded bg-gray-100 dark:bg-gray-800">
                                    <span>@{alert.account_username}</span>
                                    <div className="flex gap-1">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openTweet(alert.tweet_url);
                                        }}
                                        className="p-1 h-auto"
                                        title="View Tweet"
                                      >
                                        <ExternalLink className="w-3 h-3" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openTwitterProfile(alert.account_username);
                                        }}
                                        className="p-1 h-auto"
                                        title="View Profile"
                                      >
                                        👤
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                                
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                                  <Button
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openPhotonChart(alert.contract_address);
                                    }}
                                    className="bg-purple-600 hover:bg-purple-700 text-white"
                                  >
                                    📊 Photon 1s
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      window.open(alert.pump_fun_url, '_blank');
                                    }}
                                    className="bg-pink-600 hover:bg-pink-700 text-white"
                                  >
                                    🚀 Pump.fun
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      window.open(alert.solscan_url, '_blank');
                                    }}
                                  >
                                    🔍 Solscan
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      window.open(`https://dexscreener.com/solana/${alert.contract_address}`, '_blank');
                                    }}
                                  >
                                    📈 DexScreener
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </AlertDescription>
                        </Alert>
                      ))}
                      {caAlerts.length === 0 && (
                        <div className={`text-center py-8 ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                          No CA alerts yet. Start monitoring to see alerts appear here.
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* Versions Tab */}
          <TabsContent value="versions" className="space-y-6">
            <Card className={settings.dark_mode ? 'bg-gray-800 border-gray-700' : ''}>
              <CardHeader>
                <CardTitle className={`flex items-center gap-2 ${settings.dark_mode ? 'text-white' : ''}`}>
                  <Clock className="w-5 h-5" />
                  Create New Version
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4">
                  <Input
                    placeholder="Version tag (optional)"
                    value={newVersionTag}
                    onChange={(e) => setNewVersionTag(e.target.value)}
                    className="max-w-xs"
                  />
                  <Button onClick={createVersion}>
                    Create Snapshot
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className={settings.dark_mode ? 'bg-gray-800 border-gray-700' : ''}>
              <CardHeader>
                <CardTitle className={settings.dark_mode ? 'text-white' : ''}>
                  Version History ({versions.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {versions.map((version) => (
                    <Card key={version.id} className={`p-4 ${settings.dark_mode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50'}`}>
                      <div className="flex justify-between items-center">
                        <div>
                          <div className={`font-medium ${settings.dark_mode ? 'text-white' : ''}`}>
                            Version {version.version_number}
                            {version.tag && <span className="text-blue-600 ml-2">({version.tag})</span>}
                          </div>
                          <div className={`text-sm ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                            {formatDate(version.timestamp)}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => restoreVersion(version.id)}
                        >
                          <RotateCcw className="w-4 h-4 mr-2" />
                          Restore
                        </Button>
                      </div>
                    </Card>
                  ))}
                  {versions.length === 0 && (
                    <div className={`text-center py-8 ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                      No versions saved yet. Create your first snapshot above.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Export Tab */}
          <TabsContent value="export" className="space-y-6">
            <Card className={settings.dark_mode ? 'bg-gray-800 border-gray-700' : ''}>
              <CardHeader>
                <CardTitle className={`flex items-center gap-2 ${settings.dark_mode ? 'text-white' : ''}`}>
                  <Download className="w-5 h-5" />
                  Export Data
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <p className={settings.dark_mode ? 'text-gray-300' : 'text-gray-600'}>
                    Export all alerts, performance data, and account information as JSON.
                  </p>
                  <Button onClick={exportData} size="lg">
                    <Download className="w-5 h-5 mr-2" />
                    Export All Data
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className={settings.dark_mode ? 'bg-gray-800 border-gray-700' : ''}>
              <CardHeader>
                <CardTitle className={settings.dark_mode ? 'text-white' : ''}>Export Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className={`p-4 rounded-lg ${settings.dark_mode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                    <div className={`text-2xl font-bold ${settings.dark_mode ? 'text-white' : ''}`}>
                      {accounts.length}
                    </div>
                    <div className={`text-sm ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                      Tracked Accounts
                    </div>
                  </div>
                  <div className={`p-4 rounded-lg ${settings.dark_mode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                    <div className={`text-2xl font-bold ${settings.dark_mode ? 'text-white' : ''}`}>
                      {nameAlerts.length}
                    </div>
                    <div className={`text-sm ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                      Name Alerts
                    </div>
                  </div>
                  <div className={`p-4 rounded-lg ${settings.dark_mode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                    <div className={`text-2xl font-bold ${settings.dark_mode ? 'text-white' : ''}`}>
                      {caAlerts.length}
                    </div>
                    <div className={`text-sm ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                      CA Alerts
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* View All Accounts Modal */}
        <Dialog open={showAccountsModal} onOpenChange={handleModalClose}>
          <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                All Tracked Accounts ({filteredAccounts.length}/{accounts.length})
                {searchQuery && (
                  <Badge variant="outline" className="text-sm">
                    Filtered
                  </Badge>
                )}
              </DialogTitle>
            </DialogHeader>
            
            {/* Search Bar */}
            <div className="flex-shrink-0 pb-4">
              <div className="relative">
                <Input
                  placeholder="🔍 Search accounts... (e.g., elonmusk, bill, gates)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-10"
                />
                <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
                  🔍
                </div>
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-1 top-1/2 transform -translate-y-1/2 h-8 w-8 p-0"
                    title="Clear search"
                  >
                    ❌
                  </Button>
                )}
              </div>
              <div className={`text-sm mt-1 ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                {searchQuery ? (
                  filteredAccounts.length === 0 ? (
                    `No accounts found for "${searchQuery}"`
                  ) : (
                    `Found ${filteredAccounts.length} account${filteredAccounts.length === 1 ? '' : 's'} matching "${searchQuery}"`
                  )
                ) : (
                  "Search by username to quickly find specific accounts"
                )}
              </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto">
              <div className="space-y-4">
                {filteredAccounts.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredAccounts.map((account) => (
                      <Card key={account.id} className={`p-4 ${settings.dark_mode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50'} hover:bg-opacity-80 transition-colors`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1">
                            <div 
                              className="cursor-pointer"
                              onClick={() => openTwitterProfile(account.username)}
                              title="Click to visit Twitter profile"
                            >
                              <div className={`font-medium hover:text-blue-500 transition-colors ${settings.dark_mode ? 'text-white' : ''}`}>
                                @{account.username}
                              </div>
                              <div className={`text-sm ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                                Added {getTimeSince(account.added_at)} • Click to visit
                              </div>
                            </div>
                            <Badge variant={account.is_active ? "default" : "secondary"} className="ml-auto">
                              {account.is_active ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                          <div className="flex gap-1 ml-3">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openTwitterProfile(account.username)}
                              className="p-2"
                              title="Visit Twitter Profile"
                            >
                              🔗
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => removeAccount(account.id, account.username)}
                              className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50"
                              title="Remove Account"
                            >
                              ❌
                            </Button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : searchQuery ? (
                  <div className={`text-center py-12 ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                    <div className="text-6xl mb-4">🔍</div>
                    <div className="text-lg font-medium mb-2">No accounts found</div>
                    <div>Try searching for a different username or check your spelling</div>
                    <Button
                      variant="outline"
                      onClick={() => setSearchQuery('')}
                      className="mt-4"
                    >
                      Clear Search
                    </Button>
                  </div>
                ) : (
                  <div className={`text-center py-8 ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                    No accounts tracked yet. Import or add accounts to get started.
                  </div>
                )}
              </div>
            </div>
            
            {/* Quick Add Section (Fixed at bottom) */}
            <div className={`flex-shrink-0 mt-6 pt-4 border-t ${settings.dark_mode ? 'border-gray-600' : 'border-gray-200'}`}>
              <h4 className={`text-lg font-semibold mb-3 ${settings.dark_mode ? 'text-white' : ''}`}>
                Quick Add Account
              </h4>
              <div className="flex gap-3">
                <Input
                  placeholder="@username or username"
                  value={newAccountInput}
                  onChange={(e) => setNewAccountInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      addSingleAccount();
                    }
                  }}
                  className={`flex-1 ${getDuplicateWarning() ? 'border-orange-400' : ''}`}
                />
                <Button 
                  onClick={addSingleAccount} 
                  disabled={!newAccountInput.trim() || getDuplicateWarning()}
                >
                  Add Account
                </Button>
              </div>
              {(addAccountStatus || getDuplicateWarning()) && (
                <div className={`mt-2 text-sm ${
                  addAccountStatus?.includes('✅') ? 'text-green-600' : 
                  addAccountStatus?.includes('⚠️') || getDuplicateWarning() ? 'text-orange-600' :
                  addAccountStatus?.includes('❌') ? 'text-red-600' : 
                  settings.dark_mode ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  {getDuplicateWarning() || addAccountStatus}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Alert Details Modal */}
        <Dialog open={showAlertModal} onOpenChange={setShowAlertModal}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                <Target className="w-6 h-6 text-green-500" />
                <span className="text-2xl font-bold">${selectedAlert?.token_name}</span>
                <Badge variant="outline" className="text-lg px-3 py-1">
                  {selectedAlert?.quorum_count} Accounts
                </Badge>
              </DialogTitle>
              <div className={`text-sm ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                First seen: {selectedAlert?.first_seen ? formatDate(selectedAlert.first_seen) : 'Unknown'}
              </div>
            </DialogHeader>
            
            <div className="mt-6">
              <h3 className={`text-lg font-semibold mb-4 ${settings.dark_mode ? 'text-white' : ''}`}>
                📋 All Accounts That Mentioned ${selectedAlert?.token_name}
              </h3>
              
              <div className="space-y-3">
                {selectedAlert?.accounts?.map((account, index) => (
                  <Card key={index} className={`p-4 ${settings.dark_mode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50'} hover:bg-opacity-80 transition-colors`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full text-blue-600 dark:text-blue-300 font-bold text-sm">
                          {index + 1}
                        </div>
                        <div>
                          <div className={`font-medium text-lg ${settings.dark_mode ? 'text-white' : ''}`}>
                            @{account.username}
                          </div>
                          <div className={`text-sm ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                            Mentioned ${selectedAlert?.token_name}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {account.tweet_url && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openTweet(account.tweet_url)}
                            className="hover:bg-blue-50"
                            title="View Original Tweet"
                          >
                            🐦 View Tweet
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openTwitterProfile(account.username)}
                          className="hover:bg-green-50"
                          title="Visit X Profile"
                        >
                          👤 Profile
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>

              {(!selectedAlert?.accounts || selectedAlert.accounts.length === 0) && (
                <div className={`text-center py-8 ${settings.dark_mode ? 'text-gray-400' : 'text-gray-500'}`}>
                  <div className="text-4xl mb-2">📭</div>
                  <div>No account details available for this alert</div>
                </div>
              )}

              <div className={`mt-6 p-4 rounded-lg ${settings.dark_mode ? 'bg-gray-800' : 'bg-blue-50'}`}>
                <div className="flex items-start gap-3">
                  <div className="text-2xl">💡</div>
                  <div>
                    <div className={`font-semibold ${settings.dark_mode ? 'text-white' : ''}`}>
                      High Confidence Signal
                    </div>
                    <div className={`text-sm ${settings.dark_mode ? 'text-gray-300' : 'text-gray-600'}`}>
                      ${selectedAlert?.token_name} was mentioned by {selectedAlert?.quorum_count} different accounts, 
                      indicating strong community interest or potential trending status.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

export default App;