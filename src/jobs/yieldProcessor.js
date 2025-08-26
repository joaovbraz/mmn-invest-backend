// Arquivo: src/jobs/yieldProcessor.js - VERSÃO FINAL

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export async function processDailyYields() {
  console.log('🤖 Tarefa de rendimentos iniciada...');
  const today = new Date();
  const dayOfWeek = today.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    console.log('É fim de semana. Nenhum rendimento a ser processado. 😴');
    return { message: 'Fim de semana, nenhum rendimento processado.' };
  }
  const activeInvestments = await prisma.investment.findMany({
    where: { status: 'ACTIVE' },
    include: { plan: true, user: { include: { wallet: true } } },
  });
  if (activeInvestments.length === 0) {
    console.log('Nenhum investimento ativo encontrado.');
    return { message: 'Nenhum investimento ativo para processar.' };
  }
  let successCount = 0;
  let errorCount = 0;
  let completedCount = 0;
  for (const investment of activeInvestments) {
    if (!investment.user.wallet) {
      console.warn(`AVISO: Usuário ID ${investment.userId} não possui carteira. Pulando.`);
      errorCount++;
      continue;
    }
    const yieldAmount = investment.plan.price * (investment.plan.dailyReturn / 100);
    try {
      await prisma.$transaction(async (prisma) => {
        await prisma.wallet.update({
          where: { id: investment.user.wallet.id },
          data: { balance: { increment: yieldAmount } },
        });
        await prisma.transaction.create({
          data: {
            walletId: investment.user.wallet.id,
            amount: yieldAmount,
            type: 'DAILY_YIELD',
            description: `Rendimento diário do ${investment.plan.name}`,
          },
        });
        const updatedInvestment = await prisma.investment.update({
          where: { id: investment.id },
          data: { payoutsMade: { increment: 1 } },
        });
        if (updatedInvestment.payoutsMade >= investment.plan.durationDays) {
          await prisma.investment.update({
            where: { id: investment.id },
            data: { status: 'COMPLETED' },
          });
          completedCount++;
          console.log(`🎉 Investimento ID ${investment.id} concluído.`);
        }
      });
      successCount++;
    } catch (error) {
      errorCount++;
      console.error(`❌ ERRO ao processar o investimento ID ${investment.id}:`, error);
    }
  }
  const summary = `Processamento concluído. ${successCount} pagamentos realizados, ${completedCount} contratos finalizados, ${errorCount} falhas.`;
  console.log(summary);
  return { message: summary };
}