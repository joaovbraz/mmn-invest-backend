// Arquivo: prisma/seed.js - 100% COMPLETO E CORRIGIDO

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando o processo de seeding...');

  // 1. APAGAMOS PRIMEIRO OS INVESTIMENTOS (os "contratos")
  await prisma.investment.deleteMany({});
  console.log('Investimentos de teste antigos removidos.');

  // 2. DEPOIS APAGAMOS OS PLANOS (o "catálogo")
  await prisma.plan.deleteMany({});
  console.log('Planos antigos removidos.');

  console.log('Iniciando o seeding com os 7 planos...');
  const plans = [
    { name: 'Plano Cobre', price: 50.00, dailyReturn: 4.0, durationDays: 40 },
    { name: 'Plano Bronze', price: 100.00, dailyReturn: 4.0, durationDays: 40 },
    { name: 'Plano Prata', price: 300.00, dailyReturn: 4.0, durationDays: 40 },
    { name: 'Plano Ouro', price: 500.00, dailyReturn: 4.0, durationDays: 40 },
    { name: 'Plano Platina', price: 1000.00, dailyReturn: 4.0, durationDays: 40 },
    { name: 'Plano Diamante', price: 5000.00, dailyReturn: 4.0, durationDays: 40 },
    { name: 'Plano Lendário', price: 10000.00, dailyReturn: 4.0, durationDays: 40 },
  ];

  for (const plan of plans) {
    await prisma.plan.create({
      data: plan,
    });
    console.log(`Plano "${plan.name}" criado.`);
  }

  console.log('Seeding concluído com sucesso!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });