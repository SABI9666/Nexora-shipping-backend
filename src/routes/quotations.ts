import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createQuotation,
  getQuotations,
  getQuotation,
  updateQuotation,
  deleteQuotation,
  downloadQuotationDocx,
} from '../controllers/quotationController';

const router = Router();

router.use(authenticate);

router.get('/', getQuotations);
router.post('/', createQuotation);
router.get('/:id', getQuotation);
router.get('/:id/docx', downloadQuotationDocx);
router.patch('/:id', updateQuotation);
router.delete('/:id', deleteQuotation);

export default router;
