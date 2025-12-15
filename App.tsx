
import React from 'react';
import { SnookerGame } from './components/SnookerGame';

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-1 md:p-4">
        <SnookerGame />
    </div>
  );
};

export default App;
