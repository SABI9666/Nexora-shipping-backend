import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createBankAccount,
  getBankAccounts,
  getBankAccount,
  updateBankAccount,
  deleteBankAccount,
} from '../controllers/bankAccountController';

const router = Router();

router.use(authenticate);

router.get('/', getBankAccounts);
router.post('/', createBankAccount);
router.get('/:id', getBankAccount);
router.patch('/:id', updateBankAccount);
router.delete('/:id', deleteBankAccount);

export default router;
