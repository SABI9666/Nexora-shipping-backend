import { Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { paginate } from '../utils/helpers';

const createSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  notes: z.string().optional(),
  isActive: z.boolean().optional().default(true),
});

const updateSchema = createSchema.partial();

export const createSalesperson = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = createSchema.parse(req.body);
    const sp = await prisma.salesperson.create({
      data: { ...data, email: data.email || null },
    });
    res.status(201).json({ success: true, message: 'Salesperson created', data: sp });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const getSalespersons = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 100;
    const search = req.query.search as string | undefined;
    const activeOnly = req.query.active === 'true';

    const where = {
      ...(activeOnly ? { isActive: true } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' as const } },
              { name: { contains: search, mode: 'insensitive' as const } },
              { phone: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [salespersons, total] = await prisma.$transaction([
      prisma.salesperson.findMany({
        where,
        ...paginate(page, limit),
        orderBy: { code: 'asc' },
      }),
      prisma.salesperson.count({ where }),
    ]);

    res.json({
      success: true,
      data: salespersons,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

export const getSalesperson = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sp = await prisma.salesperson.findUnique({ where: { id: req.params.id } });
    if (!sp) throw new AppError('Salesperson not found', 404);
    res.json({ success: true, data: sp });
  } catch (error) {
    next(error);
  }
};

export const updateSalesperson = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = updateSchema.parse(req.body);
    const sp = await prisma.salesperson.update({
      where: { id: req.params.id },
      data: {
        ...data,
        ...(data.email !== undefined ? { email: data.email || null } : {}),
      },
    });
    res.json({ success: true, message: 'Salesperson updated', data: sp });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const deleteSalesperson = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await prisma.salesperson.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Salesperson deleted' });
  } catch (error) {
    next(error);
  }
};
