import { Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../types';
import { paginate } from '../utils/helpers';

const subAccountSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
});

const createSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1),
  arabicName: z.string().optional(),
  accountGroupId: z.string().uuid(),
  destination: z.string().optional(),
  address: z.string().optional(),
  road: z.string().optional(),
  place: z.string().optional(),
  route: z.string().optional(),
  subRoute: z.string().optional(),
  phone1: z.string().optional(),
  mobile1: z.string().optional(),
  mobile2: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  financeEmail: z.string().email().optional().or(z.literal('')),
  contactPerson: z.string().optional(),
  acContactPerson: z.string().optional(),
  acMobileNo: z.string().optional(),
  rep: z.string().optional(),
  rep2: z.string().optional(),
  repId: z.string().uuid().optional().or(z.literal('')),
  rep2Id: z.string().uuid().optional().or(z.literal('')),
  opBalance: z.number().default(0),
  opBalanceType: z.enum(['Credit', 'Debit']).default('Credit'),
  narration: z.string().optional(),
  paymentTerms: z.string().optional(),
  trn: z.string().optional(),
  creditDays: z.number().int().min(0).default(0),
  creditInvoices: z.number().int().min(0).default(0),
  creditLimit: z.number().min(0).default(0),
  customerGroupId: z.string().uuid().optional(),
  deliveryAddress: z.string().optional(),
  subAccounts: z.array(subAccountSchema).optional(),
});

const updateSchema = createSchema.partial();

const include = {
  accountGroup: { select: { id: true, code: true, name: true, groupType: true } },
  customerGroup: { select: { id: true, code: true, name: true } },
  salesperson: { select: { id: true, code: true, name: true, phone: true, email: true } },
  salesperson2: { select: { id: true, code: true, name: true, phone: true, email: true } },
  subAccounts: true,
};

export const createAccount = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = createSchema.parse(req.body);
    const { subAccounts, ...accountData } = data;

    const account = await prisma.account.create({
      data: {
        ...accountData,
        email: accountData.email || null,
        financeEmail: accountData.financeEmail || null,
        repId: accountData.repId || null,
        rep2Id: accountData.rep2Id || null,
        ...(subAccounts && subAccounts.length > 0
          ? { subAccounts: { create: subAccounts } }
          : {}),
      },
      include,
    });

    res.status(201).json({ success: true, message: 'Account created', data: account });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const getAccounts = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const search = req.query.search as string | undefined;
    const accountGroupId = req.query.accountGroupId as string | undefined;

    const where = {
      ...(accountGroupId ? { accountGroupId } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' as const } },
              { name: { contains: search, mode: 'insensitive' as const } },
              { phone1: { contains: search, mode: 'insensitive' as const } },
              { mobile1: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [accounts, total] = await prisma.$transaction([
      prisma.account.findMany({
        where,
        ...paginate(page, limit),
        orderBy: { code: 'asc' },
        include,
      }),
      prisma.account.count({ where }),
    ]);

    res.json({
      success: true,
      data: accounts,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

export const getAccount = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const account = await prisma.account.findUnique({
      where: { id: req.params.id },
      include,
    });
    if (!account) throw new AppError('Account not found', 404);
    res.json({ success: true, data: account });
  } catch (error) {
    next(error);
  }
};

export const getAccountByCode = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const account = await prisma.account.findUnique({
      where: { code: req.params.code },
      include,
    });
    if (!account) throw new AppError('Account not found', 404);
    res.json({ success: true, data: account });
  } catch (error) {
    next(error);
  }
};

export const updateAccount = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const data = updateSchema.parse(req.body);
    const { subAccounts, ...accountData } = data;

    const account = await prisma.account.update({
      where: { id: req.params.id },
      data: {
        ...accountData,
        ...(accountData.email !== undefined ? { email: accountData.email || null } : {}),
        ...(accountData.financeEmail !== undefined ? { financeEmail: accountData.financeEmail || null } : {}),
        ...(accountData.repId !== undefined ? { repId: accountData.repId || null } : {}),
        ...(accountData.rep2Id !== undefined ? { rep2Id: accountData.rep2Id || null } : {}),
        ...(subAccounts
          ? {
              subAccounts: {
                deleteMany: {},
                create: subAccounts,
              },
            }
          : {}),
      },
      include,
    });

    res.json({ success: true, message: 'Account updated', data: account });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: error.errors[0].message });
      return;
    }
    next(error);
  }
};

export const deleteAccount = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    await prisma.account.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Account deleted' });
  } catch (error) {
    next(error);
  }
};
