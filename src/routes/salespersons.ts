import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createSalesperson,
  getSalespersons,
  getSalesperson,
  updateSalesperson,
  deleteSalesperson,
} from '../controllers/salespersonController';

const router = Router();

router.use(authenticate);

router.get('/', getSalespersons);
router.post('/', createSalesperson);
router.get('/:id', getSalesperson);
router.patch('/:id', updateSalesperson);
router.delete('/:id', deleteSalesperson);

export default router;
