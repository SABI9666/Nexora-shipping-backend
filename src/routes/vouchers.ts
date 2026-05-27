import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { upload } from '../middleware/upload';
import {
  createVoucher,
  updateVoucher,
  getVouchers,
  getVoucher,
  deleteVoucher,
  getReferenceValue,
  getOpenBills,
  downloadVoucherPdf,
} from '../controllers/voucherController';

const router = Router();

router.use(authenticate);

router.get('/reference', getReferenceValue);
router.get('/open-bills', getOpenBills);
router.get('/', getVouchers);
router.post('/', upload.single('file'), createVoucher);
router.get('/:id/download/pdf', downloadVoucherPdf);
router.get('/:id', getVoucher);
router.put('/:id', upload.single('file'), updateVoucher);
router.delete('/:id', deleteVoucher);

export default router;
