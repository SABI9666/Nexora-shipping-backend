import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createChargeItem,
  getChargeItems,
  getChargeItem,
  updateChargeItem,
  deleteChargeItem,
} from '../controllers/chargeItemController';

const router = Router();

router.use(authenticate);

router.get('/', getChargeItems);
router.post('/', createChargeItem);
router.get('/:id', getChargeItem);
router.patch('/:id', updateChargeItem);
router.delete('/:id', deleteChargeItem);

export default router;
