import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  trackShipment,
  getShipments,
  getShipment,
  updateShipmentStatus,
  getShipmentStats,
} from '../controllers/shipmentController';

const router = Router();

// Public route - no auth required
router.get('/track/:trackingNumber', trackShipment);

// Protected routes
router.use(authenticate);
router.get('/stats', getShipmentStats);
router.get('/', getShipments);
router.get('/:id', getShipment);
router.patch('/:id/status', authorize('ADMIN', 'DRIVER'), updateShipmentStatus);

export default router;
