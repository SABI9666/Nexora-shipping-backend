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

// Admin only: Update shipment status and add event
export const updateShipmentStatus = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const data = addEventSchema.parse(req.body);

    const shipment = await prisma.shipment.findUnique({ where: { id } });
    if (!shipment) throw new AppError('Shipment not found', 404);

    const updatedShipment = await prisma.$transaction(async (tx) => {
      const event = await tx.shipmentEvent.create({
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
        // Also update order status
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
