import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  salesSummary,
  ordersSummary,
  voucherRegister,
  outstandingReceivables,
  accountStatement,
  dashboardSnapshot,
} from '../controllers/reportsController';

const router = Router();

router.use(authenticate);

router.get('/dashboard', dashboardSnapshot);
router.get('/sales-summary', salesSummary);
router.get('/orders-summary', ordersSummary);
router.get('/voucher-register', voucherRegister);
router.get('/outstanding-receivables', outstandingReceivables);
router.get('/account-statement', accountStatement);

export default router;
