import { Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { uploadFileToGCS, getSignedUrl, deleteFileFromGCS } from '../config/gcs';

const DOCUMENT_TYPES = ['invoice', 'bill_of_lading', 'customs', 'proof_of_delivery', 'other'];

export const uploadDocument = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.file) throw new AppError('No file uploaded', 400);

    const { orderId, shipmentId, type } = req.body;

    if (!DOCUMENT_TYPES.includes(type)) {
      throw new AppError(`Invalid document type. Must be one of: ${DOCUMENT_TYPES.join(', ')}`, 400);
    }

    const isAdmin = req.user!.role === Role.ADMIN;

    // Verify access to the order/shipment only if IDs are provided
    if (orderId) {
      const order = await prisma.order.findFirst({
        where: { id: orderId, ...(isAdmin ? {} : { userId: req.user!.id }) },
      });
      if (!order) throw new AppError('Order not found or access denied', 404);
    }

    if (shipmentId) {
      const shipment = await prisma.shipment.findFirst({
        where: { id: shipmentId, ...(isAdmin ? {} : { userId: req.user!.id }) },
      });
      if (!shipment) throw new AppError('Shipment not found or access denied', 404);
    }

    const folder = orderId
      ? `orders/${orderId}`
      : shipmentId
      ? `shipments/${shipmentId}`
      : `users/${req.user!.id}`;

    const { url, gcsPath } = await uploadFileToGCS(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      folder
    );

    const document = await prisma.document.create({
      data: {
        name: req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'),
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        url,
        gcsPath,
        type,
        orderId: orderId || null,
        shipmentId: shipmentId || null,
        uploadedBy: req.user!.id,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Document uploaded successfully',
      data: document,
    });
  } catch (error) {
    next(error);
  }
};

export const getDocuments = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { orderId, shipmentId } = req.query;
    const isAdmin = req.user!.role === Role.ADMIN;

    // Build where clause to verify user has access
    const where: Record<string, unknown> = {};
    if (orderId) {
      const order = await prisma.order.findFirst({
        where: { id: orderId as string, ...(isAdmin ? {} : { userId: req.user!.id }) },
      });
      if (!order) throw new AppError('Order not found', 404);
      where.orderId = orderId;
    } else if (shipmentId) {
      const shipment = await prisma.shipment.findFirst({
        where: { id: shipmentId as string, ...(isAdmin ? {} : { userId: req.user!.id }) },
      });
      if (!shipment) throw new AppError('Shipment not found', 404);
      where.shipmentId = shipmentId;
    } else {
      // Return documents uploaded by this user
      where.uploadedBy = req.user!.id;
    }

    const documents = await prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    });

    res.json({ success: true, data: documents });
  } catch (error) {
    next(error);
  }
};

export const getDocumentSignedUrl = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const isAdmin = req.user!.role === Role.ADMIN;

    const document = await prisma.document.findUnique({
      where: { id },
      include: { order: true, shipment: true },
    });

    if (!document) throw new AppError('Document not found', 404);

    // Check access
    if (!isAdmin) {
      const hasAccess =
        (document.order && document.order.userId === req.user!.id) ||
        (document.shipment && document.shipment.userId === req.user!.id) ||
        document.uploadedBy === req.user!.id;

      if (!hasAccess) throw new AppError('Access denied', 403);
    }

    const signedUrl = await getSignedUrl(document.gcsPath, 60);

    res.json({ success: true, data: { signedUrl, expiresIn: 3600 } });
  } catch (error) {
    next(error);
  }
};

export const deleteDocument = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const isAdmin = req.user!.role === Role.ADMIN;

    const document = await prisma.document.findUnique({
      where: { id },
    });

    if (!document) throw new AppError('Document not found', 404);

    if (!isAdmin && document.uploadedBy !== req.user!.id) {
      throw new AppError('Access denied', 403);
    }

    await deleteFileFromGCS(document.gcsPath);
    await prisma.document.delete({ where: { id } });

    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (error) {
    next(error);
  }
};
