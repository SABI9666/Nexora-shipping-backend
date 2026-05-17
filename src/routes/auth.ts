import { Router } from 'express';
import { register, login, refreshToken, logout, getMe, makeAdmin, adminLogin, adminStatus } from '../controllers/authController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refreshToken);
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, getMe);
router.post('/make-admin', makeAdmin);
router.post('/admin-login', adminLogin);
router.get('/admin-status', adminStatus);

export default router;
