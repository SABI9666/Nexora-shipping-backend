import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AccountGroupType } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';

const createSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1),
  groupType: z.nativeEnum(AccountGroupType),
  printOrder: z.number().int().min(0).default(0),
});

const updateSchema = z.object({
  code: z.string().min(1).max(20).optional(),
  name: z.string().min(1).optional(),
  groupType: z.nativeEnum(AccountGroupType).optional(),
  printOrder: z.number().int().min(0).optional(),
});

export const createAccountGroup = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = createSchema.parse(req.body);
    const group = await prisma.accountGroup.create({ data });
    res.status(201).json({ success: true, message: 'Account group created', data: group });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const getAccountGroups = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
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
    const groups = await prisma.accountGroup.findMany({
      where,
      orderBy: [{ printOrder: 'asc' }, { code: 'asc' }],
    });
    res.json({ success: true, data: groups });
  } catch (error) {
    next(error);
  }
};

export const getAccountGroup = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const group = await prisma.accountGroup.findUnique({ where: { id: req.params.id } });
    if (!group) throw new AppError('Account group not found', 404);
    res.json({ success: true, data: group });
  } catch (error) {
    next(error);
  }
};

export const updateAccountGroup = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = updateSchema.parse(req.body);
    const group = await prisma.accountGroup.update({ where: { id: req.params.id }, data });
    res.json({ success: true, message: 'Account group updated', data: group });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const deleteAccountGroup = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await prisma.accountGroup.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Account group deleted' });
  } catch (error) {
    next(error);
  }
};
