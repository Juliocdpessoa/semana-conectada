type SearchableUser = { full_name: string | null; email: string | null };

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

// Only filter the already-authorized list; never fetch a broader set of users.
export function filterUsersBySearch<T extends SearchableUser>(users: readonly T[], search: string): T[] {
  const terms = normalize(search).trim().split(/\s+/).filter(Boolean);
  return users.filter((user) => {
    const text = normalize(`${user.full_name ?? ""} ${user.email ?? ""}`);
    return terms.every((term) => text.includes(term));
  });
}
