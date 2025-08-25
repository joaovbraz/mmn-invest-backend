// Arquivo: src/jobs/yieldProcessor.js - VERSÃO ATUALIZADA

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Agora a função é "exportada", ou seja, pode ser chamada por outros arquivos
export async function processDailyYields() {
  console.log('🤖 Tarefa de rendimentos iniciada por gatilho de API...');

  const today = new Date();
  const dayOfWeek = today.getDay();

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    console.log('É fim de semana. Nenhum rendimento a ser processado. 😴');
    // Em vez de sair, retornamos uma mensagem
    return { message: 'Fim de semana, nenhum rendimento processado.' };
  }

  const activeInvestments = await prisma.investment.findMany({
    where: { status: 'ACTIVE' },
    include: {
      plan: true,
      user: { include: { wallet: true } },
    },
  });

  if (activeInvestments.length === 0) {
    console.log('Nenhum investimento ativo encontrado.');
    return { message: 'Nenhum investimento ativo para processar.' };
  }

  let successCount = 0;
  let errorCount = 0;

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
      });
      successCount++;
    } catch (error) {
      errorCount++;
      console.error(`❌ ERRO ao processar o investimento ID ${investment.id}:`, error);
    }
  }
  
  const summary = `Processamento concluído. ${successCount} pagamentos realizados, ${errorCount} falhas.`;
  console.log(summary);
  return { message: summary };
}