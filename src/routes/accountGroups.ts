import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createAccountGroup,
  getAccountGroups,
  getAccountGroup,
  updateAccountGroup,
  deleteAccountGroup,
} from '../controllers/accountGroupController';

const router = Router();

router.use(authenticate);

router.get('/', getAccountGroups);
router.post('/', createAccountGroup);
router.get('/:id', getAccountGroup);
router.patch('/:id', updateAccountGroup);
router.delete('/:id', deleteAccountGroup);

export default router;
