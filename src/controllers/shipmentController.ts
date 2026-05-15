import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { ShipmentStatus, Role } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { paginate } from '../utils/helpers';

const addEventSchema = z.object({
  status: z.nativeEnum(ShipmentStatus),
  location: z.string().min(2),
  description: z.string().min(5),
  timestamp: z.string().datetime().optional(),
});

const updateShipmentSchema = z.object({
  origin: z.string().min(1).optional(),
  destination: z.string().min(1).optional(),
  currentLocation: z.string().optional().nullable(),
  weight: z.number().positive().optional(),
  description: z.string().optional().nullable(),
  carrier: z.string().optional().nullable(),
  estimatedDelivery: z.string().datetime().optional().nullable().or(z.literal('')),
  actualDelivery: z.string().datetime().optional().nullable().or(z.literal('')),
});

// Public: Track by tracking number (no auth required)
export const trackShipment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { trackingNumber } = req.params;

    const shipment = await prisma.shipment.findUnique({
      where: { trackingNumber: trackingNumber.toUpperCase() },
      include: {
        events: { orderBy: { timestamp: 'asc' } },
        order: {
          select: {
            orderNumber: true,
            packageDescription: true,
            weight: true,
            pickupCity: true,
            pickupCountry: true,
            deliveryCity: true,
            deliveryCountry: true,
          },
        },
      },
    });

    if (!shipment) throw new AppError('Shipment not found. Please check your tracking number.', 404);

    res.json({ success: true, data: shipment });
  } catch (error) {
    next(error);
  }
};

export const getShipments = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as ShipmentStatus | undefined;
    const search = req.query.search as string | undefined;

    const isAdmin = req.user!.role === Role.ADMIN;
    const where = {
      ...(isAdmin ? {} : { userId: req.user!.id }),
      ...(status ? { status } : {}),
      ...(search ? {
        OR: [
          { trackingNumber: { contains: search, mode: 'insensitive' as const } },
          { origin: { contains: search, mode: 'insensitive' as const } },
          { destination: { contains: search, mode: 'insensitive' as const } },
        ],
      } : {}),
    };

    const [shipments, total] = await prisma.$transaction([
      prisma.shipment.findMany({
        where,
        ...paginate(page, limit),
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          order: { select: { orderNumber: true } },
          _count: { select: { events: true } },
        },
      }),
      prisma.shipment.count({ where }),
    ]);

    res.json({
      success: true,
      data: shipments,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

export const getShipment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const isAdmin = req.user!.role === Role.ADMIN;

    const shipment = await prisma.shipment.findFirst({
      where: { id, ...(isAdmin ? {} : { userId: req.user!.id }) },
      include: {
        events: { orderBy: { timestamp: 'desc' } },
        order: true,
        documents: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!shipment) throw new AppError('Shipment not found', 404);

    res.json({ success: true, data: shipment });
  } catch (error) {
    next(error);
  }
};

// Edit shipment metadata (origin / destination / weight / carrier / dates).
// Status changes still go through updateShipmentStatus so they create an event.
export const updateShipment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const data = updateShipmentSchema.parse(req.body);

    const existing = await prisma.shipment.findUnique({ where: { id } });
    if (!existing) throw new AppError('Shipment not found', 404);

    const updateData: {
      origin?: string;
      destination?: string;
      currentLocation?: string | null;
      weight?: number;
      description?: string | null;
      carrier?: string | null;
      estimatedDelivery?: Date | null;
      actualDelivery?: Date | null;
    } = {};

    if (data.origin !== undefined) updateData.origin = data.origin;
    if (data.destination !== undefined) updateData.destination = data.destination;
    if (data.currentLocation !== undefined) updateData.currentLocation = data.currentLocation || null;
    if (data.weight !== undefined) updateData.weight = data.weight;
    if (data.description !== undefined) updateData.description = data.description || null;
    if (data.carrier !== undefined) updateData.carrier = data.carrier || null;
    if (data.estimatedDelivery !== undefined) {
      updateData.estimatedDelivery = data.estimatedDelivery ? new Date(data.estimatedDelivery) : null;
    }
    if (data.actualDelivery !== undefined) {
      updateData.actualDelivery = data.actualDelivery ? new Date(data.actualDelivery) : null;
    }

    const updated = await prisma.shipment.update({
      where: { id },
      data: updateData,
      include: {
        events: { orderBy: { timestamp: 'desc' } },
        order: { select: { orderNumber: true } },
      },
    });

    res.json({ success: true, message: 'Shipment updated', data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const deleteShipment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const shipment = await prisma.shipment.findUnique({ where: { id } });
    if (!shipment) throw new AppError('Shipment not found', 404);

    // Documents reference the shipment without cascade — detach them so the
    // file records survive even after the shipment is removed.
    await prisma.$transaction([
      prisma.document.updateMany({ where: { shipmentId: id }, data: { shipmentId: null } }),
      prisma.shipment.delete({ where: { id } }),
    ]);

    res.json({ success: true, message: 'Shipment deleted' });
  } catch (error) {
    next(error);
  }
};

// Admin / Driver only: Update shipment status and add event
export const updateShipmentStatus = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const data = addEventSchema.parse(req.body);

    const shipment = await prisma.shipment.findUnique({ where: { id } });
    if (!shipment) throw new AppError('Shipment not found', 404);

    const updatedShipment = await prisma.$transaction(async (tx) => {
      await tx.shipmentEvent.create({
        data: {
          shipmentId: id,
          status: data.status,
          location: data.location,
          description: data.description,
          timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
        },
      });

      const updateData: { status: ShipmentStatus; currentLocation: string; actualDelivery?: Date } = {
        status: data.status,
        currentLocation: data.location,
      };

      if (data.status === ShipmentStatus.DELIVERED) {
        updateData.actualDelivery = new Date();
        if (shipment.orderId) {
          await tx.order.update({
            where: { id: shipment.orderId },
            data: { status: 'COMPLETED' },
          });
        }
      }

      const updated = await tx.shipment.update({
        where: { id },
        data: updateData,
        include: {
          events: { orderBy: { timestamp: 'desc' } },
        },
      });

      return updated;
    });

    res.json({
      success: true,
      message: 'Shipment status updated',
      data: updatedShipment,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const getShipmentStats = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const isAdmin = req.user!.role === Role.ADMIN;
    const userId = isAdmin ? undefined : req.user!.id;

    const [total, byStatus, recentDeliveries] = await prisma.$transaction([
      prisma.shipment.count({ where: userId ? { userId } : {} }),
      prisma.shipment.groupBy({
        by: ['status'],
        where: userId ? { userId } : {},
        _count: true,
        orderBy: { status: 'asc' },
      }),
      prisma.shipment.count({
        where: {
          ...(userId ? { userId } : {}),
          status: ShipmentStatus.DELIVERED,
          actualDelivery: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    res.json({
      success: true,
      data: {
        total,
        byStatus: byStatus.reduce((acc, item) => ({ ...acc, [item.status]: item._count }), {}),
        deliveredLast30Days: recentDeliveries,
      },
    });
  } catch (error) {
    next(error);
  }
};
