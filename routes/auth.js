/*
  Zion — Auth routes (login + signup).
  Cloned from Splendor unchanged; uses the standard users table.
*/

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.json({ success: false, error: 'Username and password required' });
    }

    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .eq('username', username.toLowerCase())
      .limit(1);

    if (error) {
      console.error('Database error during login:', error);
      return res.json({ success: false, error: 'Login failed. Please try again.' });
    }

    if (!users || users.length === 0) {
      return res.json({ success: false, error: 'Invalid username or password' });
    }

    const user = users[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.json({ success: false, error: 'Invalid username or password' });
    }

    const { password_hash, ...userResponse } = user;
    res.json({ success: true, user: userResponse });
  } catch (err) {
    console.error('Login error:', err);
    res.json({ success: false, error: 'Login failed. Please try again.' });
  }
});

router.post('/signup', async (req, res) => {
  try {
    const { username, password, displayName } = req.body;

    if (!username || !password || !displayName) {
      return res.json({ success: false, error: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.json({ success: false, error: 'Password must be at least 6 characters' });
    }

    if (username.length < 3) {
      return res.json({ success: false, error: 'Username must be at least 3 characters' });
    }

    const { data: existingUsers, error: checkError } = await supabase
      .from('users')
      .select('id')
      .eq('username', username.toLowerCase())
      .limit(1);

    if (checkError) {
      console.error('Database error during signup check:', checkError);
      return res.json({ success: false, error: 'Signup failed. Please try again.' });
    }

    if (existingUsers && existingUsers.length > 0) {
      return res.json({ success: false, error: 'Username already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert([{
        username: username.toLowerCase(),
        display_name: displayName,
        password_hash: passwordHash,
        created_at: new Date().toISOString(),
        last_active: new Date().toISOString()
      }])
      .select()
      .single();

    if (insertError) {
      console.error('Database error during user creation:', insertError);
      return res.json({ success: false, error: 'Account creation failed. Please try again.' });
    }

    const { password_hash, ...userResponse } = newUser;
    res.json({ success: true, user: userResponse });
  } catch (err) {
    console.error('Signup error:', err);
    res.json({ success: false, error: 'Account creation failed. Please try again.' });
  }
});

module.exports = router;
