const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = 'jrai_doudizhu_secret_2026';

// MongoDB Connection
mongoose.connect('mongodb+srv://buenosairesampy563_db_user:congcong2012@cluster0.aaks5du.mongodb.net/?appName=Cluster0')
  .then(() => console.log('Connected to MongoDB successfully.'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// User Schema
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  coins: { type: Number, default: 1000 },
  unlockedSkins: { type: [String], default: ['default'] },
  equippedSkin: { type: String, default: 'default' }
});

const User = mongoose.model('User', UserSchema);

// Auth Middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ success: false, msg: 'No token provided' });
  try {
    const decoded = jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, msg: 'Invalid or expired token' });
  }
};

// 1. Register
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, msg: '账号密码不能为空' });
  
  try {
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ success: false, msg: '账号已存在' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();

    res.json({ success: true, msg: '注册成功，请登录！' });
  } catch (err) {
    res.status(500).json({ success: false, msg: '服务器错误' });
  }
});

// 2. Login
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
    res.status(500).json({ success: false, msg: '服务器错误' });
  }
});

// 3. Get Profile
app.get('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, msg: '服务器错误' });
  }
});

// 4. Market - Buy Skin
app.post('/api/market/buy', authMiddleware, async (req, res) => {
  const { skinId, price } = req.body;
  try {
    const user = await User.findById(req.userId);
    if (user.unlockedSkins.includes(skinId)) {
      return res.status(400).json({ success: false, msg: '已拥有该皮肤' });
    }
    if (user.coins < price) {
      return res.status(400).json({ success: false, msg: '金币不足' });
    }

    user.coins -= price;
    user.unlockedSkins.push(skinId);
    user.equippedSkin = skinId;
    await user.save();

    res.json({ success: true, coins: user.coins, unlockedSkins: user.unlockedSkins, equippedSkin: user.equippedSkin });
  } catch (err) {
    res.status(500).json({ success: false, msg: '购买失败' });
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
    res.status(500).json({ success: false, msg: '设置失败' });
  }
});

// 6. Account Management - Delete Account (注销)
app.post('/api/user/delete', authMiddleware, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.userId);
    res.json({ success: true, msg: '账号已注销' });
  } catch (err) {
    res.status(500).json({ success: false, msg: '注销失败' });
  }
});

// 7. Game Reward (Add Coins on Match Finish)
app.post('/api/game/reward', authMiddleware, async (req, res) => {
  const { amount } = req.body;
  try {
    const user = await User.findById(req.userId);
    user.coins += amount;
    if (user.coins < 0) user.coins = 0;
    await user.save();
    res.json({ success: true, coins: user.coins });
  } catch (err) {
    res.status(500).json({ success: false, msg: '结算失败' });
  }
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
