const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'jrai_secure_doudizhu_secret_2026';
const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://buenosairesampy563_db_user:congcong2012@cluster0.aaks5du.mongodb.net/?appName=Cluster0';

mongoose.connect(MONGO_URI)
  .then(() => console.log('Successfully connected to MongoDB.'))
  .catch(err => console.error('MongoDB Connection Error:', err));

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  coins: {
    doudizhu: { type: Number, default: 1000 },
    zhajinhua: { type: Number, default: 1000 },
    blackjack: { type: Number, default: 1000 }
  },
  unlockedSkins: { type: [String], default: ['default'] },
  equippedSkin: { type: String, default: 'default' }
}, { minimize: false });

const User = mongoose.model('User', UserSchema);

const SERVER_SKINS = {
  'default': { price: 0 },
  'gold': { price: 500 },
  'red': { price: 800 },
  'purple': { price: 1200 }
};

const GAME_RULES = {
  doudizhu: { WIN: 200, LOSE: -100, VERIFY_SUCCESS: 500, VERIFY_FAIL: -200 },
  zhajinhua: { FOLD: -20, SHOWDOWN_WIN: 60, SHOWDOWN_LOSE: -40 },
  blackjack: { WIN: 50, BLACKJACK_WIN: 75, LOSE: -50, PUSH: 0 }
};

// 数据模型兼容性兜底函数
function ensureUserCoins(user) {
  if (!user.coins || typeof user.coins !== 'object') {
    user.coins = { doudizhu: 1000, zhajinhua: 1000, blackjack: 1000 };
  }
  if (typeof user.coins.doudizhu !== 'number') user.coins.doudizhu = 1000;
  if (typeof user.coins.zhajinhua !== 'number') user.coins.zhajinhua = 1000;
  if (typeof user.coins.blackjack !== 'number') user.coins.blackjack = 1000;
  if (!user.unlockedSkins || !Array.isArray(user.unlockedSkins)) {
    user.unlockedSkins = ['default'];
  }
}

const authMiddleware = (req, res, next) => {
  const token = req.cookies.auth_token;
  if (!token) return res.status(401).json({ success: false, msg: '未登录或登录失效' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.clearCookie('auth_token');
    return res.status(401).json({ success: false, msg: '登录已过期' });
  }
};

/* API ROUTES */
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, msg: '账号密码不能为空' });
  try {
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ success: false, msg: '账号已存在' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ 
      username, 
      password: hashedPassword,
      coins: { doudizhu: 1000, zhajinhua: 1000, blackjack: 1000 },
      unlockedSkins: ['default'],
      equippedSkin: 'default'
    });
    await newUser.save();
    res.json({ success: true, msg: '注册成功，请登录！' });
  } catch (err) {
    res.status(500).json({ success: false, msg: '注册异常' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ success: false, msg: '账号或密码错误' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ success: false, msg: '账号或密码错误' });

    ensureUserCoins(user);
    await user.save();

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      user: {
        username: user.username,
        coins: user.coins,
        unlockedSkins: user.unlockedSkins,
        equippedSkin: user.equippedSkin
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, msg: '登录异常' });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ success: true, msg: '已退出登录' });
});

app.get('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ success: false, msg: '用户不存在' });
    ensureUserCoins(user);
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, msg: '获取用户信息失败' });
  }
});

// 购买皮肤
app.post('/api/market/buy', authMiddleware, async (req, res) => {
  const { skinId } = req.body;
  if (!skinId || !SERVER_SKINS[skinId]) return res.status(400).json({ success: false, msg: '非法皮肤标识' });

  const price = SERVER_SKINS[skinId].price;
  try {
    const user = await User.findById(req.userId);
    ensureUserCoins(user);

    if (user.unlockedSkins.includes(skinId)) {
      return res.status(400).json({ success: false, msg: '已拥有该皮肤' });
    }

    const totalCoins = user.coins.doudizhu + user.coins.zhajinhua + user.coins.blackjack;
    if (totalCoins < price) {
      return res.status(400).json({ success: false, msg: `金币不足！需要 ${price} 金币，您当前总计只有 ${totalCoins}` });
    }

    let remaining = price;
    if (user.coins.doudizhu >= remaining) {
      user.coins.doudizhu -= remaining;
    } else {
      remaining -= user.coins.doudizhu;
      user.coins.doudizhu = 0;
      if (user.coins.zhajinhua >= remaining) {
        user.coins.zhajinhua -= remaining;
      } else {
        remaining -= user.coins.zhajinhua;
        user.coins.zhajinhua = 0;
        user.coins.blackjack = Math.max(0, user.coins.blackjack - remaining);
      }
    }

    user.unlockedSkins.push(skinId);
    user.equippedSkin = skinId;
    user.markModified('coins');
    user.markModified('unlockedSkins');
    await user.save();

    res.json({
      success: true,
      coins: user.coins,
      unlockedSkins: user.unlockedSkins,
      equippedSkin: user.equippedSkin
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: '购买结算异常' });
  }
});

// 穿戴皮肤
app.post('/api/market/equip', authMiddleware, async (req, res) => {
  const { skinId } = req.body;
  try {
    const user = await User.findById(req.userId);
    ensureUserCoins(user);
    if (!user.unlockedSkins.includes(skinId)) return res.status(400).json({ success: false, msg: '未解锁该皮肤' });
    
    user.equippedSkin = skinId;
    await user.save();
    res.json({ success: true, equippedSkin: user.equippedSkin });
  } catch (err) {
    res.status(500).json({ success: false, msg: '设置失败' });
  }
});

// 游戏金币结算
app.post('/api/game/reward', authMiddleware, async (req, res) => {
  const { gameType, action } = req.body;
  if (!GAME_RULES[gameType] || typeof GAME_RULES[gameType][action] !== 'number') {
    return res.status(400).json({ success: false, msg: '非法结算参数' });
  }

  const delta = GAME_RULES[gameType][action];
  try {
    const user = await User.findById(req.userId);
    ensureUserCoins(user);

    user.coins[gameType] = Math.max(0, user.coins[gameType] + delta);
    user.markModified('coins');
    await user.save();

    res.json({ success: true, coins: user.coins, delta });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: '结算异常' });
  }
});

app.post('/api/user/delete', authMiddleware, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.userId);
    res.clearCookie('auth_token');
    res.json({ success: true, msg: '注销成功' });
  } catch (err) {
    res.status(500).json({ success: false, msg: '注销失败' });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
