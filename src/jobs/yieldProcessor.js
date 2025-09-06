// Arquivo: src/jobs/yieldProcessor.js (Versão Final Corrigida e Alinhada com o Schema)

import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

export async function processDailyYields() {
  console.log('🤖 Tarefa de rendimentos iniciada...');
  const today = new Date();
  
  // Mantida a sua ótima verificação de fim de semana
  const dayOfWeek = today.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    console.log('É fim de semana. Nenhum rendimento a ser processado. 😴');
    return { message: 'Fim de semana, nenhum rendimento processado.' };
  }

  // ✅ MELHORADO: Etapa 1 - Finalizar investimentos que já expiraram
  let completedCount = 0;
  try {
    const expiredInvestments = await prisma.investment.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: {
          lte: today, // lte = less than or equal to (menor ou igual a hoje)
        },
      },
    });
    
    if (expiredInvestments.length > 0) {
      const idsToComplete = expiredInvestments.map(inv => inv.id);
      await prisma.investment.updateMany({
        where: { id: { in: idsToComplete } },
        data: { status: 'COMPLETED' },
      });
      completedCount = expiredInvestments.length;
      console.log(`🎉 ${completedCount} investimentos expirados foram finalizados.`);
    }
  } catch(error) {
    console.error('❌ ERRO ao tentar finalizar investimentos expirados:', error);
  }

  // ✅ MELHORADO: Etapa 2 - Pagar os rendimentos dos investimentos que AINDA estão ativos
  const activeInvestments = await prisma.investment.findMany({
    where: { status: 'ACTIVE' },
    include: { plan: true, user: { include: { wallet: true } } },
  });

  if (activeInvestments.length === 0) {
    console.log('Nenhum investimento ativo para pagar rendimentos hoje.');
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

    // ✅ CORRIGIDO: Usando `dailyYield` do schema e .toNumber() para segurança
    const yieldAmount = new Prisma.Decimal(
      investment.plan.price.toNumber() * (investment.plan.dailyYield.toNumber() / 100)
    );

    try {
      await prisma.$transaction(async (tx) => {
        // Paga o rendimento na carteira
        await tx.wallet.update({
          where: { id: investment.user.wallet.id },
          data: { balance: { increment: yieldAmount } },
        });

        // Cria o registro da transação de rendimento
        await tx.transaction.create({
          data: {
            walletId: investment.user.wallet.id,
            amount: yieldAmount,
            // ✅ CORRIGIDO: Usando o enum correto 'YIELD'
            type: 'YIELD',
            description: `Rendimento diário do plano ${investment.plan.name}`,
          },
        });
      });
      successCount++;
    } catch (error) {
      errorCount++;
      console.error(`❌ ERRO ao processar o rendimento para o investimento ID ${investment.id}:`, error);
    }
  }
  
  const summary = `Processamento concluído. ${successCount} rendimentos pagos, ${completedCount} investimentos finalizados, ${errorCount} falhas.`;
  console.log(summary);
  return { message: summary };
}