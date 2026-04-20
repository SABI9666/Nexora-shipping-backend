import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createItem,
  getItems,
  getItem,
  updateItem,
  deleteItem,
} from '../controllers/itemMasterController';

const router = Router();

router.use(authenticate);

router.get('/', getItems);
router.post('/', createItem);
router.get('/:id', getItem);
router.patch('/:id', updateItem);
router.delete('/:id', deleteItem);

export default router;
