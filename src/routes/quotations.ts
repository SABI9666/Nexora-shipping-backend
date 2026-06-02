import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createQuotation,
  getQuotations,
  getQuotation,
  updateQuotation,
  deleteQuotation,
  downloadQuotationWord,
  downloadQuotationPdf,
  downloadQuotationProformaPdf,
} from '../controllers/quotationController';

const router = Router();

router.use(authenticate);

router.get('/', getQuotations);
router.post('/', createQuotation);
router.get('/:id/download/word', downloadQuotationWord);
router.get('/:id/download/pdf', downloadQuotationPdf);
router.get('/:id/download/proforma', downloadQuotationProformaPdf);
router.get('/:id', getQuotation);
router.patch('/:id', updateQuotation);
router.delete('/:id', deleteQuotation);

export default router;
