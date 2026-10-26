// Class names, joined; a false or empty one is left out. No merging: the named text steps
// (text-body, text-label) and colours (text-chalk) are both "text-", and a merger would drop one.
export const cn = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");
