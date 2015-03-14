<?php
/**
 * Login Controller
 *
 * @category   ManneBusk
 * @package    ManneBusk_DevPanel
 * @author     Manne Busk <mannebusk@gmail.com>
 */
class ManneBusk_DevPanel_LoginController extends Mage_Core_Controller_Front_Action
{
    /**
     * Login frontend user only by passing email
     * 
     */
    public function frontendAction()
    {
        $email      = $this->getRequest()->getParam('user');
        $session    = Mage::getSingleton('customer/session');
        $user       = Mage::getModel('customer/customer')
            ->setWebsiteId(Mage::app()->getWebsite()->getId())
            ->loadByEmail($email);

        $session->setCustomerAsLoggedIn($user);

        $lastUrl = Mage::getSingleton('core/session')->getLastUrl();
        Mage::app()->getResponse()->setRedirect($lastUrl)->sendResponse();
        exit;
    }
}
