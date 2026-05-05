import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { paginate } from '../utils/helpers';

const updateRoleSchema = z.object({
  role: z.nativeEnum(Role),
});

export const getUsers = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string | undefined;
    const role = req.query.role as Role | undefined;

    const where = {
      ...(role ? { role } : {}),
      ...(search ? {
        OR: [
          { email: { contains: search, mode: 'insensitive' as const } },
          { firstName: { contains: search, mode: 'insensitive' as const } },
          { lastName: { contains: search, mode: 'insensitive' as const } },
        ],
      } : {}),
    };

    const [users, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        ...paginate(page, limit),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          isVerified: true,
          createdAt: true,
          _count: { select: { orders: true, shipments: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      data: users,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

export const updateUserRole = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { role } = updateRoleSchema.parse(req.body);

    if (id === req.user!.id) {
      throw new AppError('You cannot change your own role', 400);
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError('User not found', 404);

    const updated = await prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });

    res.json({ success: true, message: 'User role updated', data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const deleteUser = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    if (id === req.user!.id) {
      throw new AppError('You cannot delete your own account', 400);
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError('User not found', 404);

    await prisma.$transaction(async (tx) => {
      const userOrders = await tx.order.findMany({
        where: { userId: id },
        select: { id: true },
      });
      const userOrderIds = userOrders.map((o) => o.id);

      await tx.document.deleteMany({
        where: {
          OR: [
            { uploadedBy: id },
            ...(userOrderIds.length ? [{ orderId: { in: userOrderIds } }] : []),
            { shipment: { userId: id } },
          ],
        },
      });

      await tx.invoice.deleteMany({
        where: {
          OR: [
            { userId: id },
            ...(userOrderIds.length ? [{ orderId: { in: userOrderIds } }] : []),
          ],
        },
      });

      await tx.quotation.deleteMany({
        where: {
          OR: [
            { userId: id },
            ...(userOrderIds.length ? [{ orderId: { in: userOrderIds } }] : []),
          ],
        },
      });

      if (userOrderIds.length) {
        await tx.shipment.updateMany({
          where: { orderId: { in: userOrderIds }, userId: { not: id } },
          data: { orderId: null },
        });
      }

      await tx.shipment.deleteMany({ where: { userId: id } });
      await tx.order.deleteMany({ where: { userId: id } });
      await tx.user.delete({ where: { id } });
    });

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    next(error);
  }
};
