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
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'jrai_secure_doudizhu_secret_2026';
const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://buenosairesampy563_db_user:congcong2012@cluster0.aaks5du.mongodb.net/?appName=Cluster0';

mongoose.connect(MONGO_URI)
  .then(() => console.log('Successfully connected to MongoDB.'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// 用户数据模型
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 20 },
  password: { type: String, required: true },
  coins: {
    doudizhu: { type: Number, default: 1000, min: 0 },
    zhajinhua: { type: Number, default: 1000, min: 0 },
    blackjack: { type: Number, default: 1000, min: 0 }
  },
  unlockedSkins: { type: [String], default: ['default'] },
  equippedSkin: { type: String, default: 'default' }
});

const User = mongoose.model('User', UserSchema);

// 后端权威皮肤价格表（禁止前端传价）
const SERVER_SKINS = {
  'default': { price: 0 },
  'gold': { price: 500 },
  'red': { price: 800 },
  'purple': { price: 1200 }
};

// 后端权威结算规则表（禁止前端传金额）
const GAME_RULES = {
  doudizhu: {
    WIN: 200,
    LOSE: -100,
    VERIFY_SUCCESS: 500,
    VERIFY_FAIL: -200
  },
  zhajinhua: {
    FOLD: -20,
    SHOWDOWN_WIN: 60,   // 标准底池收益
    SHOWDOWN_LOSE: -40
  },
  blackjack: {
    WIN: 50,
    BLACKJACK_WIN: 75,  // 3:2 赔率
    LOSE: -50,
    PUSH: 0             // 平局
  }
};

// HttpOnly Cookie 鉴权中间件
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

/* ========================================================================= */
/*                              API 接口                                     */
/* ========================================================================= */

// 1. 用户注册
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ success: false, msg: '账号与密码格式不合法' });
  }
  if (username.length < 3 || password.length < 6) {
    return res.status(400).json({ success: false, msg: '账号至少3位，密码至少6位' });
  }

  try {
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ success: false, msg: '账号已存在' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    res.json({ success: true, msg: '注册成功，请登录！' });
  } catch (err) {
    res.status(500).json({ success: false, msg: '注册异常' });
  }
});

// 2. 用户登录（写入 HttpOnly Cookie）
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ success: false, msg: '账号或密码错误' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ success: false, msg: '账号或密码错误' });

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    
    // 安全写入 HttpOnly Cookie
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

// 3. 退出登录
app.post('/api/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ success: true, msg: '已退出登录' });
});

// 4. 获取当前资料
app.get('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ success: false, msg: '用户不存在' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, msg: '获取用户信息失败' });
  }
});

// 5. 皮肤购买（服务端比对价格与扣款）
app.post('/api/market/buy', authMiddleware, async (req, res) => {
  const { skinId } = req.body;
  if (!skinId || !SERVER_SKINS[skinId]) {
    return res.status(400).json({ success: false, msg: '非法皮肤标识' });
  }

  const authoritativePrice = SERVER_SKINS[skinId].price;

  try {
    const user = await User.findById(req.userId);
    if (user.unlockedSkins.includes(skinId)) {
      return res.status(400).json({ success: false, msg: '已拥有该皮肤' });
    }

    const totalCoins = user.coins.doudizhu + user.coins.zhajinhua + user.coins.blackjack;
    if (totalCoins < authoritativePrice) {
      return res.status(400).json({ success: false, msg: '金币总额不足' });
    }

    // 服务端权威分步扣款
    let remaining = authoritativePrice;
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
    await user.save();

    res.json({
      success: true,
      coins: user.coins,
      unlockedSkins: user.unlockedSkins,
      equippedSkin: user.equippedSkin
    });
  } catch (err) {
    res.status(500).json({ success: false, msg: '购买结算异常' });
  }
});

// 6. 皮肤穿戴
app.post('/api/market/equip', authMiddleware, async (req, res) => {
  const { skinId } = req.body;
  if (!skinId || !SERVER_SKINS[skinId]) return res.status(400).json({ success: false, msg: '非法皮肤' });
  try {
    const user = await User.findById(req.userId);
    if (!user.unlockedSkins.includes(skinId)) return res.status(400).json({ success: false, msg: '未解锁该皮肤' });
    user.equippedSkin = skinId;
    await user.save();
    res.json({ success: true, equippedSkin: user.equippedSkin });
  } catch (err) {
    res.status(500).json({ success: false, msg: '设置失败' });
  }
});

// 7. 安全游戏结算（严格枚举校验，绝不信任客户端金额）
app.post('/api/game/reward', authMiddleware, async (req, res) => {
  const { gameType, action } = req.body;

  // 严格白名单与动作枚举校验
  if (!GAME_RULES[gameType] || typeof GAME_RULES[gameType][action] !== 'number') {
    return res.status(400).json({ success: false, msg: '非法结算动作或游戏类型' });
  }

  const deltaAmount = GAME_RULES[gameType][action];

  try {
    const user = await User.findById(req.userId);
    user.coins[gameType] = Math.max(0, (user.coins[gameType] || 0) + deltaAmount);
    await user.save();

    res.json({ success: true, coins: user.coins, delta: deltaAmount });
  } catch (err) {
    res.status(500).json({ success: false, msg: '结算异常' });
  }
});

// 8. 注销账户
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
