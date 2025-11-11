const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  isRead: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
});

const ConversationSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  updatedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);
const Conversation = mongoose.model('Conversation', ConversationSchema);

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

app.post('/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      name,
      email,
      password: hashedPassword
    });

    await user.save();

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    user.isOnline = true;
    await user.save();

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isOnline: user.isOnline
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/users', authenticateToken, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user.userId } })
      .select('name email isOnline lastSeen')
      .sort({ isOnline: -1, name: 1 });

    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get conversations for user
app.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user.userId
    })
    .populate('participants', 'name email isOnline')
    .populate('lastMessage')
    .sort({ updatedAt: -1 });

    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get messages for conversation
app.get('/conversations/:id/messages', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const messages = await Message.find({ conversationId: id })
      .populate('sender', 'name email')
      .sort({ timestamp: 1 });

    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('user_online', (userId) => {
    onlineUsers.set(userId, socket.id);
    socket.join(userId);
    
    User.findByIdAndUpdate(userId, { isOnline: true }).exec();
    
    socket.broadcast.emit('user_status_changed', {
      userId,
      isOnline: true
    });
  });

  socket.on('typing:start', (data) => {
    socket.to(data.receiverId).emit('typing:start', {
      senderId: data.senderId,
      senderName: data.senderName
    });
  });

  socket.on('typing:stop', (data) => {
    socket.to(data.receiverId).emit('typing:stop', {
      senderId: data.senderId
    });
  });

  // Update the message:send event to handle delivery status
socket.on('message:send', async (data) => {
  try {
    const { senderId, receiverId, text } = data;

    // Find or create conversation
    let conversation = await Conversation.findOne({
      participants: { $all: [senderId, receiverId] }
    });

    if (!conversation) {
      conversation = new Conversation({
        participants: [senderId, receiverId]
      });
      await conversation.save();
    }

    // Create message with initial status
    const message = new Message({
      conversationId: conversation._id,
      sender: senderId,
      text,
      status: 'sent' // initial status
    });
    await message.save();

    // Update conversation
    conversation.lastMessage = message._id;
    conversation.updatedAt = new Date();
    await conversation.save();

    // Populate message with sender info
    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'name email');

    // Check if receiver is online for delivery status
    const receiverSocketId = onlineUsers.get(receiverId);
    if (receiverSocketId) {
      // Update message status to delivered
      await Message.findByIdAndUpdate(message._id, { status: 'delivered' });
      populatedMessage.status = 'delivered';
      
      // Send to receiver
      io.to(receiverSocketId).emit('message:new', populatedMessage);
    }

    // Send back to sender with updated status
    socket.emit('message:new', populatedMessage);

  } catch (error) {
    console.error('Error sending message:', error);
    socket.emit('message:error', { error: error.message });
  }
});

// Add message read event
socket.on('message:read', async (data) => {
  try {
    const { messageId, conversationId } = data;
    
    // Update message status to read
    await Message.findByIdAndUpdate(messageId, { status: 'read' });
    
    // Notify sender that message was read
    const message = await Message.findById(messageId).populate('sender', 'name email');
    const senderSocketId = onlineUsers.get(message.sender._id.toString());
    
    if (senderSocketId) {
      io.to(senderSocketId).emit('message:status_update', {
        messageId,
        status: 'read'
      });
    }
  } catch (error) {
    console.error('Error marking message as read:', error);
  }
});

// Update user_online event to mark messages as read when user comes online
socket.on('user_online', (userId) => {
  onlineUsers.set(userId, socket.id);
  socket.join(userId);
  
  // Update user online status in DB
  User.findByIdAndUpdate(userId, { isOnline: true }).exec();
  
  // Mark all delivered messages as read for this user
  Message.updateMany(
    { 
      receiver: userId, 
      status: 'delivered' 
    },
    { 
      status: 'read' 
    }
  ).exec();
  
  // Broadcast to all that user is online
  socket.broadcast.emit('user_status_changed', {
    userId,
    isOnline: true
  });
});

  socket.on('disconnect', () => {
    for (let [userId, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) {
        onlineUsers.delete(userId);
        
        User.findByIdAndUpdate(userId, { 
          isOnline: false,
          lastSeen: new Date()
        }).exec();
        
        socket.broadcast.emit('user_status_changed', {
          userId,
          isOnline: false
        });
        break;
      }
    }
    console.log('User disconnected:', socket.id);
  });
});

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    server.listen(process.env.PORT, () => {
      console.log(`Server running on port ${process.env.PORT}`);
    });
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
  });