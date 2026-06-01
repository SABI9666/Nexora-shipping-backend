import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  salesSummary,
  ordersSummary,
  voucherRegister,
  outstandingReceivables,
  accountStatement,
  customerStatement,
  customerStatementPdf,
  dashboardSnapshot,
} from '../controllers/reportsController';
import { jobProfit, jobProfitPdf } from '../controllers/jobProfitController';
import { outstandingPayables } from '../controllers/outstandingPayablesController';

const router = Router();

router.use(authenticate);

router.get('/dashboard', dashboardSnapshot);
router.get('/sales-summary', salesSummary);
router.get('/orders-summary', ordersSummary);
router.get('/voucher-register', voucherRegister);
router.get('/outstanding-receivables', outstandingReceivables);
router.get('/outstanding-payables', outstandingPayables);
router.get('/account-statement', accountStatement);
router.get('/customer-statement', customerStatement);
router.get('/customer-statement/pdf', customerStatementPdf);
router.get('/job-profit', jobProfit);
router.get('/job-profit/pdf', jobProfitPdf);

export default router;
