const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'jrai_doudizhu_secret_2026';
const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://buenosairesampy563_db_user:congcong2012@cluster0.aaks5du.mongodb.net/?appName=Cluster0';

mongoose.connect(MONGO_URI)
  .then(() => console.log('Successfully connected to MongoDB.'))
  .catch(err => console.error('MongoDB Connection Error:', err));

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  coins: {
    doudizhu: { type: Number, default: 1000 },
    zhajinhua: { type: Number, default: 1000 },
    blackjack: { type: Number, default: 1000 }
  },
  unlockedSkins: { type: [String], default: ['default'] },
  equippedSkin: { type: String, default: 'default' }
});

const User = mongoose.model('User', UserSchema);

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ success: false, msg: '未登录' });
  try {
    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, msg: '登录过期' });
  }
};

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, msg: '账号密码不能为空' });
  try {
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ success: false, msg: '账号已存在' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    res.json({ success: true, msg: '注册成功！' });
  } catch (err) {
    res.status(500).json({ success: false, msg: '服务器错误' });
  }
});

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

app.get('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, msg: '服务器错误' });
  }
});

app.post('/api/market/buy', authMiddleware, async (req, res) => {
  const { skinId, price } = req.body;
  try {
    const user = await User.findById(req.userId);
    if (user.unlockedSkins.includes(skinId)) return res.status(400).json({ success: false, msg: '已拥有该皮肤' });

    const totalCoins = user.coins.doudizhu + user.coins.zhajinhua + user.coins.blackjack;
    if (totalCoins < price) return res.status(400).json({ success: false, msg: '金币不足！' });

    let remaining = price;
    if (user.coins.doudizhu >= remaining) {
      user.coins.doudizhu -= remaining;
    } else {
      remaining -= user.coins.doudizhu; user.coins.doudizhu = 0;
      if (user.coins.zhajinhua >= remaining) { user.coins.zhajinhua -= remaining; }
      else { remaining -= user.coins.zhajinhua; user.coins.zhajinhua = 0; user.coins.blackjack -= remaining; }
    }

    user.unlockedSkins.push(skinId);
    user.equippedSkin = skinId;
    await user.save();

    res.json({ success: true, coins: user.coins, unlockedSkins: user.unlockedSkins, equippedSkin: user.equippedSkin });
  } catch (err) {
    res.status(500).json({ success: false, msg: '购买失败' });
  }
});

app.post('/api/market/equip', authMiddleware, async (req, res) => {
  const { skinId } = req.body;
  try {
    const user = await User.findById(req.userId);
    if (!user.unlockedSkins.includes(skinId)) return res.status(400).json({ success: false, msg: '未解锁' });
    user.equippedSkin = skinId;
    await user.save();
    res.json({ success: true, equippedSkin: user.equippedSkin });
  } catch (err) {
    res.status(500).json({ success: false, msg: '设置失败' });
  }
});

app.post('/api/game/reward', authMiddleware, async (req, res) => {
  const { gameType, amount } = req.body;
  try {
    const user = await User.findById(req.userId);
    if (!user.coins[gameType] && user.coins[gameType] !== 0) user.coins[gameType] = 1000;
    user.coins[gameType] += amount;
    if (user.coins[gameType] < 0) user.coins[gameType] = 0;
    await user.save();
    res.json({ success: true, coins: user.coins });
  } catch (err) {
    res.status(500).json({ success: false, msg: '结算失败' });
  }
});

app.post('/api/user/delete', authMiddleware, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.userId);
    res.json({ success: true, msg: '注销成功' });
  } catch (err) {
    res.status(500).json({ success: false, msg: '注销失败' });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
