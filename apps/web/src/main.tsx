// Import React and tools needed for render
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom'; //app navigation between pages uses browswer URL
import App from './App';
import './styles.css';

//creates Reacty root with id "root"
//wraps APP with BrowswerRouter and Strickmode
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
     {/* Enable routing for app and child components */}
    <BrowserRouter> 
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

