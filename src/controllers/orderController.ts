import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { OrderStatus, Role } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { generateOrderNumber, generateTrackingNumber, calculateShippingPrice, paginate } from '../utils/helpers';

const createOrderSchema = z.object({
  pickupAddress: z.string().min(5),
  pickupCity: z.string().min(2),
  pickupCountry: z.string().length(2),
  deliveryAddress: z.string().min(5),
  deliveryCity: z.string().min(2),
  deliveryCountry: z.string().length(2),
  packageDescription: z.string().min(5),
  weight: z.number().positive().max(1000),
  length: z.number().positive().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  declaredValue: z.number().positive().optional(),
  specialInstructions: z.string().optional(),
});

const updateOrderSchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
  specialInstructions: z.string().optional(),
});

export const createOrder = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = createOrderSchema.parse(req.body);

    const price = calculateShippingPrice(data.weight, data.pickupCountry, data.deliveryCountry);

    const order = await prisma.order.create({
      data: {
        ...data,
        orderNumber: generateOrderNumber(),
        price,
        userId: req.user!.id,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: order,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const getOrders = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as OrderStatus | undefined;
    const search = req.query.search as string | undefined;

    const isAdmin = req.user!.role === Role.ADMIN;
    const where = {
      ...(isAdmin ? {} : { userId: req.user!.id }),
      ...(status ? { status } : {}),
      ...(search ? {
        OR: [
          { orderNumber: { contains: search, mode: 'insensitive' as const } },
          { packageDescription: { contains: search, mode: 'insensitive' as const } },
          { deliveryCity: { contains: search, mode: 'insensitive' as const } },
        ],
      } : {}),
    };

    const [orders, total] = await prisma.$transaction([
      prisma.order.findMany({
        where,
        ...paginate(page, limit),
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
          shipment: { select: { id: true, trackingNumber: true, status: true } },
          _count: { select: { documents: true } },
        },
      }),
      prisma.order.count({ where }),
    ]);

    res.json({
      success: true,
      data: orders,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

export const getOrder = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const isAdmin = req.user!.role === Role.ADMIN;

    const order = await prisma.order.findFirst({
      where: {
        id,
        ...(isAdmin ? {} : { userId: req.user!.id }),
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        shipment: {
          include: {
            events: { orderBy: { timestamp: 'desc' } },
          },
        },
        documents: true,
      },
    });

    if (!order) throw new AppError('Order not found', 404);

    res.json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

export const updateOrder = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const data = updateOrderSchema.parse(req.body);
    const isAdmin = req.user!.role === Role.ADMIN;

    const order = await prisma.order.findFirst({
      where: { id, ...(isAdmin ? {} : { userId: req.user!.id }) },
    });

    if (!order) throw new AppError('Order not found', 404);

    if (!isAdmin && order.status !== OrderStatus.DRAFT) {
      throw new AppError('Only draft orders can be modified', 400);
    }

    const updated = await prisma.order.update({
      where: { id },
      data,
      include: { shipment: true },
    });

    res.json({ success: true, message: 'Order updated', data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const confirmOrder = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const order = await prisma.order.findFirst({
      where: { id, userId: req.user!.id, status: OrderStatus.DRAFT },
    });

    if (!order) throw new AppError('Draft order not found', 404);

    // Create order + shipment in a transaction
    const [updatedOrder, shipment] = await prisma.$transaction([
      prisma.order.update({
        where: { id },
        data: { status: OrderStatus.CONFIRMED },
      }),
      prisma.shipment.create({
        data: {
          trackingNumber: generateTrackingNumber(),
          status: 'PENDING',
          origin: `${order.pickupCity}, ${order.pickupCountry}`,
          destination: `${order.deliveryCity}, ${order.deliveryCountry}`,
          weight: order.weight,
          description: order.packageDescription,
          carrier: 'Nexora Express',
          estimatedDelivery: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
          userId: req.user!.id,
          orderId: id,
          events: {
            create: {
              status: 'PENDING',
              location: `${order.pickupCity}, ${order.pickupCountry}`,
              description: 'Order confirmed - awaiting pickup',
            },
          },
        },
      }),
    ]);

    res.json({
      success: true,
      message: 'Order confirmed. Shipment created.',
      data: { order: updatedOrder, shipment },
    });
  } catch (error) {
    next(error);
  }
};

export const getOrderStats = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const isAdmin = req.user!.role === Role.ADMIN;
    const userId = isAdmin ? undefined : req.user!.id;

    const [total, byStatus, revenue] = await prisma.$transaction([
      prisma.order.count({ where: userId ? { userId } : {} }),
      prisma.order.groupBy({
        by: ['status'],
        where: userId ? { userId } : {},
        _count: true,
        orderBy: { status: 'asc' },
      }),
      prisma.order.aggregate({
        where: {
          ...(userId ? { userId } : {}),
          status: { in: ['COMPLETED', 'SHIPPED'] },
        },
        _sum: { price: true },
      }),
    ]);

    res.json({
      success: true,
      data: {
        total,
        byStatus: byStatus.reduce((acc, item) => ({ ...acc, [item.status]: item._count }), {}),
        totalRevenue: revenue._sum.price ?? 0,
      },
    });
  } catch (error) {
    next(error);
  }
};
