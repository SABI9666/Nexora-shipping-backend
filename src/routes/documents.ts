import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { upload } from '../middleware/upload';
import {
  uploadDocument,
  getDocuments,
  getDocumentSignedUrl,
  deleteDocument,
} from '../controllers/documentController';

const router = Router();

router.use(authenticate);

router.get('/', getDocuments);
router.post('/upload', upload.single('file'), uploadDocument);
router.get('/:id/signed-url', getDocumentSignedUrl);
router.delete('/:id', deleteDocument);

export default router;
