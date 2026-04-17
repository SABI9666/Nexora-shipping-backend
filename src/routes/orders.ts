import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  createOrder,
  getOrders,
  getOrder,
  updateOrder,
  confirmOrder,
  getOrderStats,
  deleteOrder,
} from '../controllers/orderController';

const router = Router();

router.use(authenticate);

router.get('/stats', getOrderStats);
router.get('/', getOrders);
router.post('/', createOrder);
router.get('/:id', getOrder);
router.patch('/:id', updateOrder);
router.post('/:id/confirm', confirmOrder);
router.delete('/:id', authorize('ADMIN'), deleteOrder);

export default router;
