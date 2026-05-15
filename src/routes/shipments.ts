import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  trackShipment,
  getShipments,
  getShipment,
  updateShipment,
  updateShipmentStatus,
  deleteShipment,
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
router.patch('/:id', authorize('ADMIN'), updateShipment);
router.delete('/:id', authorize('ADMIN'), deleteShipment);

export default router;
