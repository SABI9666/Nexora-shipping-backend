import { Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';

const createSchema = z.object({
  label: z.string().min(1).max(100),
  bankName: z.string().min(1),
  bankAddress: z.string().optional(),
  accountName: z.string().min(1),
  accountNumber: z.string().min(1),
  iban: z.string().optional(),
  swiftCode: z.string().optional(),
  currency: z.string().optional(),
  isDefault: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

export const createBankAccount = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = createSchema.parse(req.body);
    if (data.isDefault) {
      await prisma.bankAccount.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }
    const acct = await prisma.bankAccount.create({ data });
    res.status(201).json({ success: true, message: 'Bank account created', data: acct });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const getBankAccounts = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const accounts = await prisma.bankAccount.findMany({
      orderBy: [{ isDefault: 'desc' }, { label: 'asc' }],
    });
    res.json({ success: true, data: accounts });
  } catch (error) {
    next(error);
  }
};

export const getBankAccount = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const acct = await prisma.bankAccount.findUnique({ where: { id: req.params.id } });
    if (!acct) throw new AppError('Bank account not found', 404);
    res.json({ success: true, data: acct });
  } catch (error) {
    next(error);
  }
};

export const updateBankAccount = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = updateSchema.parse(req.body);
    if (data.isDefault) {
      await prisma.bankAccount.updateMany({
        where: { isDefault: true, NOT: { id: req.params.id } },
        data: { isDefault: false },
      });
    }
    const acct = await prisma.bankAccount.update({ where: { id: req.params.id }, data });
    res.json({ success: true, message: 'Bank account updated', data: acct });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const deleteBankAccount = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await prisma.bankAccount.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Bank account deleted' });
  } catch (error) {
    next(error);
  }
};
