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
import { listCreditNotes, createCreditNote, creditNotePdf } from '../controllers/creditNoteController';

const router = Router();

router.use(authenticate);

router.get('/', getInvoices);
router.post('/', createInvoice);
router.get('/:id/download/word', downloadInvoiceWord);
router.get('/:id/download/pdf', downloadInvoicePdf);
// Credit notes — reduce an invoice after a dispute / agreed adjustment.
router.get('/:id/credit-notes', listCreditNotes);
router.post('/:id/credit-notes', createCreditNote);
router.get('/:id/credit-notes/:creditNoteId/pdf', creditNotePdf);
router.get('/:id', getInvoice);
router.patch('/:id', updateInvoice);
router.delete('/:id', deleteInvoice);

export default router;
