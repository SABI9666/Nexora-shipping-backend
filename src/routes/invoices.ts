import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createInvoice,
  getInvoices,
  getInvoice,
  updateInvoice,
  deleteInvoice,
  downloadInvoiceWord,
  downloadInvoicePdf,
} from '../controllers/invoiceController';

const router = Router();

router.use(authenticate);

router.get('/', getInvoices);
router.post('/', createInvoice);
router.get('/:id/download/word', downloadInvoiceWord);
router.get('/:id/download/pdf', downloadInvoicePdf);
router.get('/:id', getInvoice);
router.patch('/:id', updateInvoice);
router.delete('/:id', deleteInvoice);

export default router;
