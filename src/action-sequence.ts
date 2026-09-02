export async function runOrderedActions<TAction, TContext>(
  actions: readonly TAction[],
  initialContext: TContext,
  execute: (action: TAction, index: number, context: TContext) => Promise<TContext>,
): Promise<TContext> {
  let context = initialContext;
  for (let index = 0; index < actions.length; index++) {
    context = await execute(actions[index], index, context);
  }
  return context;
}
