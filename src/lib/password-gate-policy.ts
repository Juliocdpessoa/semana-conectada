export function assertPasswordGate(data:unknown,error:unknown){
  if(error||!data||typeof data!=='object')throw new Error('Não foi possível consultar a validação de acesso. Tente novamente; não é necessário resetar sua senha.');
  const state=data as {allowed?:boolean;required?:boolean};
  if(state.required===true)throw new Error('Sua senha precisa ser redefinida. Entre novamente e escolha uma nova senha.');
  if(state.allowed!==true)throw new Error('Não foi possível validar este acesso. Entre novamente.');
}
