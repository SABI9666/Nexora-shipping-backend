import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createCustomerGroup,
  getCustomerGroups,
  getCustomerGroup,
  updateCustomerGroup,
  deleteCustomerGroup,
} from '../controllers/customerGroupController';

const router = Router();

router.use(authenticate);

router.get('/', getCustomerGroups);
router.post('/', createCustomerGroup);
router.get('/:id', getCustomerGroup);
router.patch('/:id', updateCustomerGroup);
router.delete('/:id', deleteCustomerGroup);

export default router;
