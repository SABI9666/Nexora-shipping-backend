import { Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { paginate } from '../utils/helpers';

const createSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1),
  description: z.string().optional(),
  defaultRate: z.number().nonnegative().optional(),
});

const updateSchema = z.object({
  code: z.string().min(1).max(30).optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  defaultRate: z.number().nonnegative().optional(),
});

export const createChargeItem = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = createSchema.parse(req.body);
    const item = await prisma.chargeItem.create({ data });
    res.status(201).json({ success: true, message: 'Item created', data: item });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const getChargeItems = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 200;
    const search = req.query.search as string | undefined;

    const where = search
      ? {
          OR: [
            { code: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [items, total] = await prisma.$transaction([
      prisma.chargeItem.findMany({ where, ...paginate(page, limit), orderBy: { code: 'asc' } }),
      prisma.chargeItem.count({ where }),
    ]);

    res.json({
      success: true,
      data: items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

export const getChargeItem = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const item = await prisma.chargeItem.findUnique({ where: { id: req.params.id } });
    if (!item) throw new AppError('Charge item not found', 404);
    res.json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
};

export const updateChargeItem = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = updateSchema.parse(req.body);
    const item = await prisma.chargeItem.update({ where: { id: req.params.id }, data });
    res.json({ success: true, message: 'Item updated', data: item });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const deleteChargeItem = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await prisma.chargeItem.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Item deleted' });
  } catch (error) {
    next(error);
  }
};
