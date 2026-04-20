import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createAccount,
  getAccounts,
  getAccount,
  getAccountByCode,
  updateAccount,
  deleteAccount,
} from '../controllers/accountController';

const router = Router();

router.use(authenticate);

router.get('/', getAccounts);
router.post('/', createAccount);
router.get('/by-code/:code', getAccountByCode);
router.get('/:id', getAccount);
router.patch('/:id', updateAccount);
router.delete('/:id', deleteAccount);

export default router;
