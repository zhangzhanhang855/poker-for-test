const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();

// Middlewares
app.use(express.json());
app.use(cors());

// Serve static files (index.html, styles, etc.) from root directory
app.use(express.static(__dirname));

// Render Environment Variables
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'jrai_doudizhu_secret_2026';
const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://buenosairesampy563_db_user:congcong2012@cluster0.aaks5du.mongodb.net/?appName=Cluster0';

// Connect to MongoDB Atlas / Local MongoDB
mongoose.connect(MONGO_URI)
  .then(() => console.log('Successfully connected to MongoDB.'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// MongoDB User Schema
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  coins: { type: Number, default: 1000 },
  unlockedSkins: { type: [String], default: ['default'] },
  equippedSkin: { type: String, default: 'default' }
});

const User = mongoose.model('User', UserSchema);

// JWT Verification Middleware
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ success: false, msg: '无 Token 权限，请重新登录' });
  
  try {
    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, msg: '登录已过期或凭证无效' });
  }
};

/* ========================================================================= */
/*                              API ROUTES                                   */
/* ========================================================================= */

// 1. User Registration
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, msg: '账号和密码不能为空' });

  try {
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ success: false, msg: '该账号名称已被注册' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();

    res.json({ success: true, msg: '注册成功，请使用新账号登录！' });
  } catch (err) {
    res.status(500).json({ success: false, msg: '服务器注册异常' });
  }
});

// 2. User Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ success: false, msg: '账号不存在' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ success: false, msg: '密码错误' });

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      success: true,
      token,
      user: {
        username: user.username,
        coins: user.coins,
        unlockedSkins: user.unlockedSkins,
        equippedSkin: user.equippedSkin
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, msg: '服务器登录异常' });
  }
});

// 3. Get Current User Profile
app.get('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ success: false, msg: '用户不存在' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, msg: '获取用户信息失败' });
  }
});

// 4. Market - Buy Card Skin
app.post('/api/market/buy', authMiddleware, async (req, res) => {
  const { skinId, price } = req.body;
  try {
    const user = await User.findById(req.userId);
    if (user.unlockedSkins.includes(skinId)) {
      return res.status(400).json({ success: false, msg: '您已拥有此皮肤' });
    }
    if (user.coins < price) {
      return res.status(400).json({ success: false, msg: '金币不足，无法购买' });
    }

    user.coins -= price;
    user.unlockedSkins.push(skinId);
    user.equippedSkin = skinId;
    await user.save();

    res.json({ 
      success: true, 
      coins: user.coins, 
      unlockedSkins: user.unlockedSkins, 
      equippedSkin: user.equippedSkin 
    });
  } catch (err) {
    res.status(500).json({ success: false, msg: '购买失败，服务器内部错误' });
  }
});

// 5. Market - Equip Skin
app.post('/api/market/equip', authMiddleware, async (req, res) => {
  const { skinId } = req.body;
  try {
    const user = await User.findById(req.userId);
    if (!user.unlockedSkins.includes(skinId)) {
      return res.status(400).json({ success: false, msg: '未解锁该皮肤' });
    }

    user.equippedSkin = skinId;
    await user.save();
    res.json({ success: true, equippedSkin: user.equippedSkin });
  } catch (err) {
    res.status(500).json({ success: false, msg: '设置佩戴皮肤失败' });
  }
});

// 6. Account Management - Delete Account
app.post('/api/user/delete', authMiddleware, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.userId);
    res.json({ success: true, msg: '账号注销成功' });
  } catch (err) {
    res.status(500).json({ success: false, msg: '注销失败' });
  }
});

// 7. Game Reward & Coins Settlement
app.post('/api/game/reward', authMiddleware, async (req, res) => {
  const { amount } = req.body;
  try {
    const user = await User.findById(req.userId);
    user.coins += amount;
    if (user.coins < 0) user.coins = 0;
    await user.save();
    res.json({ success: true, coins: user.coins });
  } catch (err) {
    res.status(500).json({ success: false, msg: '金币结算失败' });
  }
});

// Wildcard Route: Catch-all to serve index.html for Single Page Application
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Node Server
app.listen(PORT, () => {
  console.log(`Server executing successfully on port ${PORT}`);
});
