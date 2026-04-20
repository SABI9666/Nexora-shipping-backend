import { Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';

const createSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1),
});

const updateSchema = z.object({
  code: z.string().min(1).max(20).optional(),
  name: z.string().min(1).optional(),
});

export const createCustomerGroup = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = createSchema.parse(req.body);
    const group = await prisma.customerGroup.create({ data });
    res.status(201).json({ success: true, message: 'Customer group created', data: group });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const getCustomerGroups = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const search = req.query.search as string | undefined;
    const where = search
      ? {
          OR: [
            { code: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const groups = await prisma.customerGroup.findMany({ where, orderBy: { code: 'asc' } });
    res.json({ success: true, data: groups });
  } catch (error) {
    next(error);
  }
};

export const getCustomerGroup = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const group = await prisma.customerGroup.findUnique({ where: { id: req.params.id } });
    if (!group) throw new AppError('Customer group not found', 404);
    res.json({ success: true, data: group });
  } catch (error) {
    next(error);
  }
};

export const updateCustomerGroup = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = updateSchema.parse(req.body);
    const group = await prisma.customerGroup.update({ where: { id: req.params.id }, data });
    res.json({ success: true, message: 'Customer group updated', data: group });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const deleteCustomerGroup = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await prisma.customerGroup.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Customer group deleted' });
  } catch (error) {
    next(error);
  }
};
