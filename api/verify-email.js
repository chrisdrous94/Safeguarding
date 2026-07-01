module.exports = async (req, res) => {
  if(req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });
  return res.status(410).json({ ok:false, error:'Email access code request has been disabled. Contact the DSL team for a secure code.' });
};
