const key = 'SsxPssosbWAZLwiSVmOeHiMlM9SPgYc7';

const r = await fetch('https://api.openphone.com/v1/phone-numbers', {
  headers: { Authorization: key }
});
const data = await r.json();

// Print id, formattedNumber, name, and users for each number
for (const pn of data.data) {
  const userIds = pn.users.map(u => `${u.firstName} ${u.lastName} (${u.id})`).join(', ');
  console.log(`${pn.id} | ${pn.formattedNumber} | ${pn.name} | users: ${userIds}`);
}
