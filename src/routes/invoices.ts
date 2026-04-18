import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createInvoice,
  getInvoices,
  getInvoice,
  updateInvoice,
  deleteInvoice,
} from '../controllers/invoiceController';

const router = Router();
router.get('/:id/download/word', downloadInvoiceWord);

router.use(authenticate);

router.get('/', getInvoices);
router.post('/', createInvoice);
router.get('/:id', getInvoice);
router.patch('/:id', updateInvoice);
router.delete('/:id', deleteInvoice);

export default router;
