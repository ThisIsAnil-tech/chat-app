import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import axios from 'axios'
import { io } from 'socket.io-client'

const API_BASE = 'http://localhost:3001'

const Home = ({ onLogout }) => {
  const [users, setUsers] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [socket, setSocket] = useState(null)
  const { currentUser } = useAuth()
  const messagesEndRef = useRef(null)

  useEffect(() => {
    fetchUsers()
    setupSocket()
    return () => {
      if (socket) {
        socket.disconnect()
      }
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const setupSocket = () => {
    const token = localStorage.getItem('token')
    const newSocket = io(API_BASE, {
      auth: { token }
    })

    newSocket.emit('user_online', currentUser.id)

    newSocket.on('user_status_changed', (data) => {
      setUsers(prev => prev.map(user => 
        user._id === data.userId ? { ...user, isOnline: data.isOnline } : user
      ))
    })

    newSocket.on('message:new', (message) => {
      console.log('New message received:', message)
      setMessages(prev => {
        // Check if message already exists to avoid duplicates
        const exists = prev.find(m => m._id === message._id)
        if (exists) {
          return prev.map(m => m._id === message._id ? message : m)
        }
        return [...prev, message]
      })

      // If this is our message and it's delivered, mark as read if user is viewing
      if (message.sender._id === currentUser.id && message.status === 'delivered' && selectedUser) {
        markMessageAsRead(message._id)
      }
    })

    newSocket.on('message:status_update', (data) => {
      console.log('Message status updated:', data)
      setMessages(prev => 
        prev.map(message => 
          message._id === data.messageId 
            ? { ...message, status: data.status }
            : message
        )
      )
    })

    newSocket.on('typing:start', (data) => {
      if (data.senderId === selectedUser?._id) {
        setIsTyping(true)
      }
    })

    newSocket.on('typing:stop', (data) => {
      if (data.senderId === selectedUser?._id) {
        setIsTyping(false)
      }
    })

    newSocket.on('message:error', (error) => {
      console.error('Message error:', error)
      alert('Failed to send message')
    })

    setSocket(newSocket)
  }

  const markMessageAsRead = (messageId) => {
    if (socket) {
      socket.emit('message:read', {
        messageId,
        conversationId: null // We'll handle this based on your conversation structure
      })
    }
  }

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem('token')
      const response = await axios.get(API_BASE + '/users', {
        headers: { Authorization: `Bearer ${token}` }
      })
      setUsers(response.data)
    } catch (error) {
      console.error('Error fetching users:', error)
    }
  }

  const fetchMessages = async (userId) => {
    try {
      const token = localStorage.getItem('token')
      
      // Get conversations
      const conversationsResponse = await axios.get(API_BASE + '/conversations', {
        headers: { Authorization: `Bearer ${token}` }
      })
      
      const conversation = conversationsResponse.data.find(conv => 
        conv.participants.some(p => p._id === userId)
      )

      if (conversation) {
        const messagesResponse = await axios.get(
          `${API_BASE}/conversations/${conversation._id}/messages`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        
        // Mark messages as read when opening conversation
        const messages = messagesResponse.data
        setMessages(messages)
        
        // Mark other user's messages as read
        messages.forEach(message => {
          if (message.sender._id !== currentUser.id && message.status !== 'read') {
            markMessageAsRead(message._id)
          }
        })
      } else {
        setMessages([])
      }
    } catch (error) {
      console.error('Error fetching messages:', error)
      setMessages([])
    }
  }

  const handleUserSelect = async (user) => {
    setSelectedUser(user)
    await fetchMessages(user._id)
    setIsTyping(false)
  }

  const sendMessage = () => {
    if (!newMessage.trim() || !selectedUser || !socket) {
      console.log('Cannot send message:', { newMessage, selectedUser, socket })
      return
    }

    console.log('Sending message to:', selectedUser._id)
    
    const messageData = {
      senderId: currentUser.id,
      receiverId: selectedUser._id,
      text: newMessage.trim()
    }

    socket.emit('message:send', messageData)
    setNewMessage('')
    
    // Stop typing indicator
    socket.emit('typing:stop', {
      receiverId: selectedUser._id,
      senderId: currentUser.id
    })
  }

  const handleTyping = (text) => {
    setNewMessage(text)
    
    if (!socket || !selectedUser) return

    if (text.trim()) {
      socket.emit('typing:start', {
        receiverId: selectedUser._id,
        senderId: currentUser.id,
        senderName: currentUser.name
      })
    } else {
      socket.emit('typing:stop', {
        receiverId: selectedUser._id,
        senderId: currentUser.id
      })
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Tick mark component
  const TickMarks = ({ status }) => {
    return (
      <span className={`tick-marks ${status}`}>
        {status === 'sent' && '✓'}
        {status === 'delivered' && '✓✓'}
        {status === 'read' && '✓✓'}
      </span>
    )
  }

  return (
    <div className="home-container">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>Chats</h2>
          <div>
            <span style={{fontSize: '14px', color: '#666', marginRight: '10px'}}>
              {currentUser.name}
            </span>
            <button onClick={onLogout} className="btn" style={{width: 'auto', padding: '8px 16px'}}>
              Logout
            </button>
          </div>
        </div>
        <div className="user-list">
          {users.map(user => (
            <div
              key={user._id}
              className={`user-item ${selectedUser?._id === user._id ? 'active' : ''}`}
              onClick={() => handleUserSelect(user)}
            >
              <div className="user-name">{user.name}</div>
              <div className="user-email" style={{fontSize: '12px', color: '#666'}}>
                {user.email}
              </div>
              <div className="user-status">
                <div className={`status-dot ${user.isOnline ? 'status-online' : 'status-offline'}`}></div>
                {user.isOnline ? 'Online' : 'Offline'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className="chat-container">
        {selectedUser ? (
          <>
            <div className="chat-header">
              <h3>{selectedUser.name}</h3>
              <div className="user-status">
                <div className={`status-dot ${selectedUser.isOnline ? 'status-online' : 'status-offline'}`}></div>
                {selectedUser.isOnline ? 'Online' : 'Offline'}
              </div>
            </div>
            
            <div className="chat-messages">
              {messages.length === 0 ? (
                <div style={{textAlign: 'center', padding: '20px', color: '#666'}}>
                  No messages yet. Start a conversation!
                </div>
              ) : (
                messages.map(message => (
                  <div
                    key={message._id || message.timestamp}
                    className={`message ${message.sender._id === currentUser.id ? 'own' : 'other'}`}
                  >
                    {message.sender._id !== currentUser.id && (
                      <div className="message-sender">{message.sender.name}</div>
                    )}
                    <div className="message-text">{message.text}</div>
                    <div className="message-meta">
                      <span className="message-time">
                        {new Date(message.timestamp).toLocaleTimeString([], { 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                      </span>
                      {message.sender._id === currentUser.id && (
                        <TickMarks status={message.status || 'sent'} />
                      )}
                    </div>
                  </div>
                ))
              )}
              {isTyping && (
                <div className="typing-indicator">
                  {selectedUser.name} is typing...
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="chat-input">
              <input
                type="text"
                placeholder="Type a message..."
                value={newMessage}
                onChange={(e) => handleTyping(e.target.value)}
                onKeyPress={handleKeyPress}
              />
              <button 
                className="send-btn" 
                onClick={sendMessage}
                disabled={!newMessage.trim()}
              >
                Send
              </button>
            </div>
          </>
        ) : (
          <div style={{
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            height: '100%',
            flexDirection: 'column',
            color: '#666'
          }}>
            <h3>Welcome to Chat App</h3>
            <p>Select a user from the sidebar to start chatting</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default Home